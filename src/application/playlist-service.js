import { buildPlaylistPresentation } from "../domain/playlist-presentation.js";

function playlistError(category, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { category });
}

function allItems(roadmap) {
  return roadmap.sections.flatMap((section) => section.items);
}

export class PlaylistService {
  constructor({ roadmapRepository, navigationStore, courseAccess, appStateStore, clock = () => new Date() }) {
    this.roadmapRepository = roadmapRepository;
    this.navigationStore = navigationStore;
    this.courseAccess = courseAccess;
    this.appStateStore = appStateStore;
    this.clock = clock;
  }

  async playlistFor(playlistId) {
    const roadmap = (await this.roadmapRepository.list())
      .find((candidate) => candidate.id === playlistId && candidate.kind === "youtube-playlist");
    if (!roadmap) throw playlistError("playlist-not-found", "Такой плейлист не найден.");
    return roadmap;
  }

  async lessonSnapshots(roadmap) {
    const courseIds = [...new Set(allItems(roadmap).flatMap(({ courseId }) => courseId ? [courseId] : []))];
    const entries = await Promise.all(courseIds.map(async (courseId) => {
      try {
        return [courseId, await this.courseAccess.readLesson(courseId)];
      } catch {
        return [courseId, {
          availability: "unavailable",
          courseId,
          reason: "Пакет урока или его субтитры требуют проверки.",
        }];
      }
    }));
    return new Map(entries);
  }

  async project(roadmap) {
    const [catalogEntries, globalState] = await Promise.all([
      this.courseAccess.listCatalogEntries?.() ?? [],
      this.appStateStore.load(),
    ]);
    const lessonSnapshots = await this.lessonSnapshots(roadmap);
    let navigation = null;
    let navigationError = null;
    try {
      navigation = await this.navigationStore.get(roadmap.id);
    } catch (error) {
      navigationError = error;
    }
    const presentation = buildPlaylistPresentation({
      roadmap,
      lessonSnapshots,
      catalogEntries,
      navigation,
      globalLastCourseId: globalState.lastCourseId,
      navigationError,
    });
    return { ...presentation, navigation };
  }

  async list() {
    const roadmaps = (await this.roadmapRepository.list())
      .filter((roadmap) => roadmap.kind === "youtube-playlist");
    return Promise.all(roadmaps.map(async (roadmap) => (await this.project(roadmap)).card));
  }

  async outlineFor(playlistId) {
    return (await this.project(await this.playlistFor(playlistId))).outline;
  }

  async open(playlistId, { lessonCourseId } = {}) {
    const roadmap = await this.playlistFor(playlistId);
    const presentation = await this.project(roadmap);
    if (presentation.card.navigationError) {
      return {
        kind: "outline",
        outline: presentation.outline,
        notice: "Не удалось проверить сохранённую точку продолжения. Открой оглавление и выбери подготовленный урок.",
      };
    }
    const items = allItems(roadmap);
    let selectedCourseId = lessonCourseId ?? presentation.resumeCourseId;
    if (lessonCourseId) {
      const item = items.find(({ courseId }) => courseId === lessonCourseId);
      if (!item) {
        const planned = items.find(({ id }) => id === lessonCourseId);
        throw playlistError(
          planned ? "playlist-lesson-not-ready" : "playlist-lesson-forbidden",
          planned ? "Этот урок ещё не подготовлен." : "Этот урок не входит в выбранный плейлист.",
        );
      }
    }

    if (!selectedCourseId) {
      const selectedItem = items.find(({ courseId }) => courseId === presentation.navigation?.lastLessonCourseId);
      const notice = selectedItem && presentation.card.progress.completed > 0
        ? `Урок «${selectedItem.title}» завершён. Выбери следующий урок в оглавлении.`
        : null;
      return { kind: "outline", outline: presentation.outline, notice };
    }

    const item = items.find(({ courseId }) => courseId === selectedCourseId);
    if (!item) {
      throw playlistError("playlist-lesson-forbidden", "Этот урок не входит в выбранный плейлист.");
    }
    const status = presentation.outline.sections.flatMap((section) => section.lessons)
      .find(({ courseId }) => courseId === selectedCourseId)?.status;
    if (status === "completed") {
      return {
        kind: "outline",
        outline: presentation.outline,
        notice: `Урок «${item.title}» уже завершён. Выбери следующий урок в оглавлении.`,
      };
    }
    if (status === "planned" || status === "waiting-content") {
      return {
        kind: "outline",
        outline: presentation.outline,
        notice: "Продолжение урока ещё не подготовлено. Можно выбрать другой доступный урок.",
      };
    }
    if (status === "unavailable") {
      throw playlistError("playlist-lesson-not-ready", "Материалы этого урока требуют проверки.");
    }

    const snapshot = await this.courseAccess.readLesson(selectedCourseId);
    if (snapshot?.availability !== "available") {
      throw playlistError("playlist-lesson-not-ready", snapshot?.reason ?? "Материалы урока недоступны.");
    }
    const view = await this.courseAccess.openLesson(selectedCourseId);
    try {
      await this.navigationStore.select(roadmap.id, selectedCourseId, {
        openedAt: this.clock().toISOString(),
      });
    } catch (error) {
      throw playlistError(
        "playlist-navigation-partial",
        "Урок открыт, но выбранная точка плейлиста не сохранена. Повтори явное открытие.",
        error,
      );
    }
    return { kind: "lesson", view };
  }

  async archive(playlistId) {
    await this.navigationStore.setArchived(playlistId, true);
    return (await this.project(await this.playlistFor(playlistId))).card;
  }

  async restore(playlistId) {
    await this.navigationStore.setArchived(playlistId, false);
    return (await this.project(await this.playlistFor(playlistId))).card;
  }

  async findForCourse(courseId) {
    const roadmaps = (await this.roadmapRepository.list())
      .filter((roadmap) => roadmap.kind === "youtube-playlist");
    for (const roadmap of roadmaps) {
      const items = allItems(roadmap);
      const index = items.findIndex((item) => item.courseId === courseId);
      if (index >= 0) return { roadmap, item: items[index], lessonOrder: index + 1 };
    }
    return null;
  }

  async contextFor(courseId, view) {
    const linked = await this.findForCourse(courseId);
    if (!linked) return null;
    return {
      playlistId: linked.roadmap.id,
      playlistTitle: linked.roadmap.title,
      lessonCourseId: courseId,
      lessonTitle: linked.item.title,
      lessonOrder: linked.lessonOrder,
      lessonCompleted: view.lifecycleStatus === "complete",
    };
  }
}
