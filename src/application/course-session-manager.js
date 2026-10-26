import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openCourseAsset } from "../content/course-assets.js";
import { loadCourse } from "../content/course-repository.js";
import { validateVideoSubtitleAssets } from "../content/video-subtitle-assets.js";
import { buildCourseRoadmapOutline } from "../domain/course-outline.js";
import { LearningMemoryStore } from "../persistence/learning-memory-store.js";
import { createOperationLock } from "./operation-lock.js";
import { LearningService } from "./learning-service.js";
import { PlaylistService } from "./playlist-service.js";

function unavailable(error) {
  if (error?.category) return error;
  return Object.assign(new Error("Course is unavailable", { cause: error }), {
    category: "course-unavailable",
  });
}

function playlistError(category, message) {
  return Object.assign(new Error(message), { category });
}

function playlistLessonFailure(courseId, error) {
  const reason = error?.category === "asset-integrity" || error?.category === "asset-not-found"
    ? "Субтитры урока не прошли проверку целостности."
    : "Пакет урока требует проверки или согласованной миграции.";
  return { availability: "unavailable", courseId, reason };
}

function sourceKind(source, course) {
  if (course.videoSource) return "YouTube";
  const url = new URL(source.url);
  if (url.protocol === "file:") return path.extname(fileURLToPath(url)).toLowerCase() === ".pdf" ? "PDF" : "Файл";
  if (url.hostname.includes("youtube.com") || url.hostname === "youtu.be") return "YouTube";
  if (url.hostname.includes("github.com")) return "GitHub";
  if (url.hostname.includes("habr.com")) return "Habr";
  return url.hostname.replace(/^www\./u, "");
}

function inferredCollection(source) {
  const url = new URL(source.url);
  if (url.hostname !== "github.com" || !url.pathname.startsWith("/bojieli/ai-agent-book/")) return null;
  const isIntroduction = url.pathname.endsWith("/introduction.md");
  return {
    id: "ai-agents-in-depth",
    title: "AI Agents in Depth",
    sectionTitle: "",
    itemTitle: isIntroduction ? "Введение" : "Глава 1. Основы AI-агентов",
    order: isIntroduction ? 0 : 1,
  };
}

export class CourseSessionManager {
  constructor({
    catalogRepository,
    appStateStore,
    providerFactory,
    promptBuilder,
    projectRoot,
    clock,
    roadmapRepository = null,
    playlistStateStore = null,
  }) {
    this.catalogRepository = catalogRepository;
    this.appStateStore = appStateStore;
    this.providerFactory = providerFactory;
    this.promptBuilder = promptBuilder;
    this.projectRoot = projectRoot;
    this.clock = clock;
    this.roadmapRepository = roadmapRepository;
    this.services = new Map();
    this.serviceSignatures = new Map();
    this.operationLocks = new Map();
    this.playlistService = playlistStateStore && roadmapRepository
      ? new PlaylistService({
        roadmapRepository,
        navigationStore: playlistStateStore,
        appStateStore,
        clock,
        courseAccess: {
          readLesson: (courseId) => this.readPlaylistLesson(courseId),
          openLesson: (courseId) => this.openLesson(courseId),
          listCatalogEntries: () => this.catalogRepository.list(),
        },
      })
      : null;
  }

  async courseFileSignature(courseId) {
    const stat = await fs.stat(this.catalogRepository.coursePath(courseId), { bigint: true });
    return [stat.mtimeNs, stat.ctimeNs, stat.size].join(":");
  }

  async serviceFor(courseId) {
    await this.catalogRepository.get(courseId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.courseFileSignature(courseId);
      if (this.services.has(courseId) && before === this.serviceSignatures.get(courseId)) {
        return this.services.get(courseId);
      }
      try {
        const course = await loadCourse(this.catalogRepository.coursePath(courseId));
        const after = await this.courseFileSignature(courseId);
        if (before !== after) continue;
        let operationLock = this.operationLocks.get(courseId);
        if (!operationLock) {
          operationLock = createOperationLock();
          this.operationLocks.set(courseId, operationLock);
        }
        const expectedSignature = after;
        const service = new LearningService({
          course,
          store: new LearningMemoryStore(this.catalogRepository.memoryPath(courseId)),
          provider: this.providerFactory({ course, courseId, projectRoot: this.projectRoot }),
          promptBuilder: this.promptBuilder,
          clock: this.clock,
          operationLock,
          assertCurrentCourse: async () => {
            if (await this.courseFileSignature(courseId) !== expectedSignature) {
              throw unavailable(new Error("Course changed after this learning view was created"));
            }
          },
          onLifecycleChange: async ({ lifecycleStatus }) => {
            if (lifecycleStatus !== "complete") return undefined;
            if (await this.playlistService?.findForCourse(courseId)) return undefined;
            return this.archiveCourse(courseId);
          },
        });
        await service.loadState();
        if (await this.courseFileSignature(courseId) !== expectedSignature) continue;
        this.services.set(courseId, service);
        this.serviceSignatures.set(courseId, expectedSignature);
        return service;
      } catch (error) {
        throw unavailable(error);
      }
    }
    throw unavailable(new Error("Course changed repeatedly while being opened"));
  }

  async openLesson(courseId) {
    try {
      const service = await this.serviceFor(courseId);
      const view = await service.getView();
      await this.appStateStore.update({ lastCourseId: courseId });
      return view;
    } catch (error) {
      throw unavailable(error);
    }
  }

  async open(courseId) {
    if (this.playlistService) {
      const linked = await this.playlistService.findForCourse(courseId);
      if (linked) {
        const result = await this.playlistService.open(linked.roadmap.id, { lessonCourseId: courseId });
        if (result.kind === "lesson") return this.decorateView(courseId, result.view);
        return { kind: "outline", ...result };
      }
    }
    return this.openLesson(courseId);
  }

  async readPlaylistLesson(courseId) {
    try {
      await this.catalogRepository.get(courseId);
      const course = await loadCourse(this.catalogRepository.coursePath(courseId));
      if (course.schemaVersion !== 7 || !course.videoSource) {
        return playlistLessonFailure(courseId, new Error("Playlist item is not a YouTube course"));
      }
      await validateVideoSubtitleAssets({
        course,
        courseDirectory: path.dirname(this.catalogRepository.coursePath(courseId)),
      });
      return await (await this.serviceFor(courseId)).getPlaylistLessonSnapshot();
    } catch (error) {
      return playlistLessonFailure(courseId, error);
    }
  }

  async listPlaylists() {
    return this.playlistService ? this.playlistService.list() : [];
  }

  async playlistOutlineFor(playlistId) {
    if (!this.playlistService) throw playlistError("playlist-not-found", "Такой плейлист не найден.");
    return this.playlistService.outlineFor(playlistId);
  }

  async openPlaylist(playlistId, options = {}) {
    if (!this.playlistService) throw playlistError("playlist-not-found", "Такой плейлист не найден.");
    const result = await this.playlistService.open(playlistId, options);
    if (result.kind === "lesson") {
      return { ...result, view: await this.decorateView(result.view.courseId, result.view) };
    }
    return result;
  }

  async archivePlaylist(playlistId) {
    if (!this.playlistService) throw playlistError("playlist-not-found", "Такой плейлист не найден.");
    return this.playlistService.archive(playlistId);
  }

  async restorePlaylist(playlistId) {
    if (!this.playlistService) throw playlistError("playlist-not-found", "Такой плейлист не найден.");
    return this.playlistService.restore(playlistId);
  }

  async decorateView(courseId, view) {
    if (!this.playlistService) return view;
    const playlistContext = await this.playlistService.contextFor(courseId, view);
    return playlistContext ? { ...view, playlistContext } : view;
  }

  async getLastCourseId() {
    const { lastCourseId } = await this.appStateStore.load();
    if (!lastCourseId) return null;
    try {
      await this.catalogRepository.get(lastCourseId);
      return lastCourseId;
    } catch (error) {
      if (error?.category === "course-not-found") return null;
      throw error;
    }
  }

  async listCourses() {
    const [entries, lastCourseId] = await Promise.all([
      this.catalogRepository.list(),
      this.getLastCourseId(),
    ]);
    const roadmapByCourse = new Map();
    if (this.roadmapRepository) {
      const roadmaps = await this.roadmapRepository.list();
      roadmaps.forEach((roadmap) => roadmap.sections.forEach((section) => section.items.forEach((item) => {
        if (item.courseId) {
          roadmapByCourse.set(item.courseId, {
            id: roadmap.id,
            title: roadmap.title,
            sectionTitle: section.title,
            itemTitle: item.title,
            order: item.order,
          });
        }
      })));
    }
    return Promise.all(entries.map(async (entry) => {
      try {
        const service = await this.serviceFor(entry.id);
        const summary = await service.getSummary();
        const source = service.course.source;
        const sourceUrl = new URL(source.url);
        const sourceHref = sourceUrl.protocol === "file:"
          ? `/api/courses/${encodeURIComponent(entry.id)}/source`
          : source.url;
        return {
          ...entry,
          availability: "available",
          source: {
            title: source.title,
            author: source.author ?? service.course.videoSource?.channel ?? null,
            kind: sourceKind(source, service.course),
            url: sourceHref,
          },
          collection: roadmapByCourse.get(entry.id) ?? inferredCollection(source),
          ...summary,
          isLast: entry.id === lastCourseId,
        };
      } catch {
        return {
          ...entry,
          availability: "unavailable",
          errorCode: "COURSE_UNAVAILABLE",
          message: "Курс требует проверки или согласованной миграции.",
          isLast: false,
        };
      }
    }));
  }

  async archiveCourse(courseId) {
    await this.catalogRepository.setArchived(courseId, true);
    const { lastCourseId } = await this.appStateStore.load();
    if (lastCourseId === courseId) {
      await this.appStateStore.update({ lastCourseId: null });
    }
    return this.listCourses();
  }

  async restoreCourse(courseId) {
    await this.catalogRepository.setArchived(courseId, false);
    return this.listCourses();
  }

  async outlineFor(courseId) {
    const service = await this.serviceFor(courseId);
    const outline = await service.getOutline();
    if (!this.roadmapRepository) return outline;
    const roadmap = await this.roadmapRepository.forCourse(courseId);
    if (!roadmap) return outline;

    const summaries = new Map();
    const courseIds = roadmap.sections.flatMap((section) => section.items)
      .map((item) => item.courseId)
      .filter(Boolean);
    await Promise.all(courseIds.map(async (linkedCourseId) => {
      try {
        const linkedService = await this.serviceFor(linkedCourseId);
        summaries.set(linkedCourseId, await linkedService.getSummary());
      } catch {
        summaries.set(linkedCourseId, { lifecycleStatus: "unavailable" });
      }
    }));

    return {
      ...outline,
      roadmap: buildCourseRoadmapOutline(roadmap, summaries, courseId),
    };
  }

  async sourceFor(courseId) {
    const service = await this.serviceFor(courseId);
    const sourceUrl = new URL(service.course.source.url);
    if (sourceUrl.protocol !== "file:") {
      throw Object.assign(new Error("Course source is not a local file"), { category: "source-not-local" });
    }
    const filePath = path.resolve(fileURLToPath(sourceUrl));
    const relativePath = path.relative(this.projectRoot, filePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw Object.assign(new Error("Course source is outside the project"), { category: "source-not-local" });
    }
    return { filePath, title: service.course.source.title };
  }

  async reviewFor(courseId, unitId) {
    return (await this.serviceFor(courseId)).getReview(unitId);
  }

  async assetFor(courseId, fileName) {
    const service = await this.serviceFor(courseId);
    return openCourseAsset({
      course: service.course,
      courseDirectory: path.dirname(this.catalogRepository.coursePath(courseId)),
      fileName,
    });
  }
}
