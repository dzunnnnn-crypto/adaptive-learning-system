import { largeRoadmapDocument } from "./fixtures/large-roadmap.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseSessionManager } from "../src/application/course-session-manager.js";
import { CatalogRepository } from "../src/content/catalog-repository.js";
import { CourseRoadmapRepository } from "../src/content/course-roadmap-repository.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { AppStateStore } from "../src/persistence/app-state-store.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";
import { PlaylistStateStore } from "../src/persistence/playlist-state-store.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";
import { makePlaylistFixture, writePlaylistFixture } from "./fixtures/playlist.js";

const directories = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function writeMemory(file, state) {
  await fs.writeFile(file, `# Память курса\n\n<!-- adaptive-learning-state:start\n${JSON.stringify(state, null, 2)}\nadaptive-learning-state:end -->\n`, "utf8");
}

async function makeManager({
  invalidCourseId = null,
  missingMemoryId = null,
  renderableCourseId = null,
  roadmap = null,
  courseEntries = null,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "course-sessions-"));
  directories.push(root);
  const coursesRoot = path.join(root, "courses");
  const entries = courseEntries ?? [
    { id: "build-skills", order: 1, title: "Build skills", summary: "Навыки Codex из официальной статьи." },
    { id: "js-fetch", order: 2, title: "JS Fetch", summary: "Практические запросы к внешнему API." },
  ];
  await fs.mkdir(coursesRoot, { recursive: true });
  await fs.writeFile(path.join(coursesRoot, "catalog.json"), JSON.stringify({ schemaVersion: 1, courses: entries }), "utf8");
  if (roadmap) {
    await fs.writeFile(path.join(coursesRoot, "roadmaps.json"), JSON.stringify(roadmap), "utf8");
  }

  for (const entry of entries) {
    const directory = path.join(coursesRoot, entry.id);
    await fs.mkdir(directory, { recursive: true });
    if (entry.id === invalidCourseId) {
      await fs.writeFile(path.join(directory, "course.json"), "invalid json", "utf8");
      continue;
    }
    const course = {
      ...makeUniversalCourse({ withRenderableArtifacts: entry.id === renderableCourseId }),
      id: entry.id,
      title: entry.title,
    };
    if (entry.id === renderableCourseId) {
      const assetsDirectory = path.join(directory, "assets");
      await fs.mkdir(assetsDirectory);
      await fs.writeFile(path.join(assetsDirectory, "foundation-map.png"), png);
      course.sourceArtifacts[0].content.sha256 = createHash("sha256").update(png).digest("hex");
    }
    await fs.writeFile(path.join(directory, "course.json"), JSON.stringify(course), "utf8");
    if (entry.id !== missingMemoryId) {
      await writeMemory(path.join(directory, "learning_memory.md"), createInitialState(course));
    }
  }

  const appStateStore = new AppStateStore(path.join(root, "data", "app-state.json"));
  const catalogRepository = new CatalogRepository({
    coursesRoot,
    catalogPath: path.join(coursesRoot, "catalog.json"),
  });
  const manager = new CourseSessionManager({
    catalogRepository,
    appStateStore,
    providerFactory: () => ({ generate: vi.fn() }),
    promptBuilder: vi.fn(),
    projectRoot: root,
    clock: () => new Date("2026-07-19T20:00:00.000Z"),
    roadmapRepository: roadmap
      ? new CourseRoadmapRepository({ roadmapsPath: path.join(coursesRoot, "roadmaps.json") })
      : null,
  });
  return { manager, appStateStore, root };
}

async function makePlaylistManager({ lessonStates = ["new", "current", "planned"] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "playlist-course-sessions-"));
  directories.push(root);
  const fixture = makePlaylistFixture({ id: "playlist-a", lessonStates });
  const coursesRoot = path.join(root, "courses");
  await writePlaylistFixture({ root, fixture });
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  const catalogEntries = fixture.catalogEntries.map((entry, index) => ({ ...entry, order: index + 1 }));
  await fs.writeFile(path.join(coursesRoot, "catalog.json"), JSON.stringify({ schemaVersion: 1, courses: catalogEntries }), "utf8");
  await fs.writeFile(path.join(coursesRoot, "roadmaps.json"), JSON.stringify({ schemaVersion: 1, roadmaps: [fixture.roadmap] }), "utf8");
  const appStateStore = new AppStateStore(path.join(root, "data", "app-state.json"));
  const catalogRepository = new CatalogRepository({ coursesRoot, catalogPath: path.join(coursesRoot, "catalog.json") });
  const roadmapRepository = new CourseRoadmapRepository({ roadmapsPath: path.join(coursesRoot, "roadmaps.json") });
  const playlistStateStore = new PlaylistStateStore(path.join(root, "data", "playlist-state.json"));
  const manager = new CourseSessionManager({
    catalogRepository,
    appStateStore,
    providerFactory: () => ({ generate: vi.fn() }),
    promptBuilder: vi.fn(),
    projectRoot: root,
    clock: () => new Date("2026-10-12T10:00:00.000Z"),
    roadmapRepository,
    playlistStateStore,
  });
  return { appStateStore, catalogRepository, fixture, manager, playlistStateStore, root };
}

describe("CourseSessionManager", () => {
  it("keeps progress isolated and stores only the last successfully opened course", async () => {
    const { manager, appStateStore } = await makeManager();

    const build = await manager.open("build-skills");
    await (await manager.serviceFor("build-skills")).answer("А");
    const fetchView = await manager.open("js-fetch");

    expect(build.courseId).toBe("build-skills");
    expect(fetchView.courseId).toBe("js-fetch");
    expect((await (await manager.serviceFor("js-fetch")).getView()).answerHistory).toEqual([]);
    expect(await appStateStore.load()).toEqual({
      lastCourseId: "js-fetch",
      aiProfileId: "codex-terra-medium",
    });
  });

  it("returns an unavailable card without hiding valid courses", async () => {
    const { manager } = await makeManager({ invalidCourseId: "js-fetch" });

    expect(await manager.listCourses()).toEqual([
      expect.objectContaining({ id: "build-skills", availability: "available", lifecycleStatus: "new" }),
      expect.objectContaining({
        id: "js-fetch",
        availability: "unavailable",
        errorCode: "COURSE_UNAVAILABLE",
        message: "Курс требует проверки или согласованной миграции.",
      }),
    ]);
  });

  it("automatically archives a course when its learning state reaches complete", async () => {
    const { manager, appStateStore } = await makeManager();
    await manager.open("build-skills");
    const service = await manager.serviceFor("build-skills");
    const state = await service.loadState();
    state.status = "complete";
    state.completedUnitIds = service.course.units.map((unit) => unit.id);
    state.activeUnitIds = [];
    state.activeQuestionUnitId = null;

    await service.persistAndView(state);
    const courses = await manager.listCourses();
    expect(courses.find((course) => course.id === "build-skills")).toEqual(
      expect.objectContaining({ archived: true, lifecycleStatus: "complete", isLast: false }),
    );
    expect(await appStateStore.load()).toEqual({
      lastCourseId: null,
      aiProfileId: "codex-terra-medium",
    });
  });

  it("does not update lastCourseId when a course cannot open", async () => {
    const { manager, appStateStore } = await makeManager({ invalidCourseId: "js-fetch" });
    await manager.open("build-skills");

    await expect(manager.open("js-fetch")).rejects.toMatchObject({ category: "course-unavailable" });
    expect(await appStateStore.load()).toEqual({
      lastCourseId: "build-skills",
      aiProfileId: "codex-terra-medium",
    });
  });

  it("does not silently recreate a missing course memory", async () => {
    const { manager, root } = await makeManager({ missingMemoryId: "js-fetch" });
    const memoryPath = path.join(root, "courses", "js-fetch", "learning_memory.md");

    await expect(manager.open("js-fetch"))
      .rejects.toMatchObject({ category: "course-unavailable" });
    await expect(fs.stat(memoryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads outline and review without changing lastCourseId", async () => {
    const { manager, appStateStore } = await makeManager();
    await manager.open("js-fetch");
    const before = await appStateStore.load();
    const service = await manager.serviceFor("build-skills");
    service.getOutline = vi.fn().mockResolvedValue({ courseId: "build-skills" });
    service.getReview = vi.fn().mockResolvedValue({
      courseId: "build-skills",
      unit: { id: "foundation-goal" },
    });

    await expect(manager.outlineFor("build-skills"))
      .resolves.toMatchObject({ courseId: "build-skills" });
    await expect(manager.reviewFor("build-skills", "foundation-goal"))
      .resolves.toMatchObject({ unit: { id: "foundation-goal" } });
    expect(await appStateStore.load()).toEqual(before);
  });

  it("adds a linked full roadmap to the selected course without changing navigation", async () => {
    const roadmap = {
      schemaVersion: 1,
      roadmaps: [{
        id: "agent-workflow",
        title: "Агенты",
        sections: [{
          id: "module-one",
          title: "Модуль 1",
          order: 1,
          items: [
            { id: "introduction", title: "Введение", order: 1, courseId: "build-skills" },
            { id: "chapter-one", title: "Глава 1", order: 2, courseId: "js-fetch" },
            { id: "chapter-two", title: "Глава 2", order: 3 },
          ],
        }],
      }],
    };
    const { manager, appStateStore } = await makeManager({ roadmap });
    await manager.open("build-skills");
    const before = await appStateStore.load();

    const outline = await manager.outlineFor("js-fetch");

    expect(outline.roadmap).toMatchObject({
      id: "agent-workflow",
      progress: { completed: 0, prepared: 2, total: 3 },
    });
    expect(outline.roadmap.sections[0].items.map((item) => item.status))
      .toEqual(["available", "current", "planned"]);
    expect(await appStateStore.load()).toEqual(before);
  });

  it("projects the 47-item agents roadmap without changing navigation or course memories", async () => {
    const roadmap = largeRoadmapDocument();
    const courseEntries = [
      {
        id: "agenty-i-vajbkoding-introduction-pilot",
        order: 1,
        title: "Введение",
        summary: "Введение к агентам и вайб-кодингу.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-1",
        order: 2,
        title: "Что такое агент",
        summary: "Первая глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-2",
        order: 3,
        title: "Глава 2",
        summary: "Вторая глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-3",
        order: 4,
        title: "Глава 3",
        summary: "Третья глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-4",
        order: 5,
        title: "Глава 4",
        summary: "Четвертая глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-5",
        order: 6,
        title: "Глава 5",
        summary: "Пятая глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-6",
        order: 7,
        title: "Глава 6",
        summary: "Шестая глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-7",
        order: 8,
        title: "Глава 7",
        summary: "Седьмая глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-8",
        order: 9,
        title: "Глава 8",
        summary: "Восьмая глава курса.",
      },
      {
        id: "agenty-i-vajbkoding-chapter-9",
        order: 10,
        title: "Глава 9",
        summary: "Девятая глава курса.",
      },
    ];
    const { manager, appStateStore, root } = await makeManager({ roadmap, courseEntries });
    await appStateStore.save({
      lastCourseId: "agenty-i-vajbkoding-chapter-1",
      aiProfileId: "codex-luna-high",
    });
    const appStatePath = path.join(root, "data", "app-state.json");
    const memoryPaths = courseEntries.map((entry) => path.join(
      root,
      "courses",
      entry.id,
      "learning_memory.md",
    ));
    const beforeAppState = await fs.readFile(appStatePath, "utf8");
    const beforeMemories = await Promise.all(memoryPaths.map((memoryPath) => fs.readFile(memoryPath, "utf8")));

    const outline = await manager.outlineFor("agenty-i-vajbkoding-chapter-1");

    expect(outline.roadmap).toMatchObject({
      id: "agenty-i-vajbkoding",
      progress: { completed: 0, prepared: 10, total: 47 },
    });
    expect(outline.roadmap.sections).toHaveLength(13);
    expect(outline.roadmap.sections.flatMap((section) => section.items)).toHaveLength(47);
    expect(outline.roadmap.sections.flatMap((section) => section.items)
      .filter((item) => item.status === "planned")).toHaveLength(37);
    expect(await fs.readFile(appStatePath, "utf8")).toBe(beforeAppState);
    await expect(Promise.all(memoryPaths.map((memoryPath) => fs.readFile(memoryPath, "utf8"))))
      .resolves.toEqual(beforeMemories);
  });

  it("reads only a declared image through the selected course", async () => {
    const { manager } = await makeManager({ renderableCourseId: "build-skills" });

    const asset = await manager.assetFor("build-skills", "foundation-map.png");
    expect(asset).toMatchObject({
      contentType: "image/png",
      presentation: "image",
      sizeBytes: png.length,
    });
    expect(asset).not.toHaveProperty("buffer");
    await expect(manager.assetFor("build-skills", "private.png"))
      .rejects.toMatchObject({ category: "asset-not-found" });
  });

  it("does not archive a completed playlist lesson and returns its outline", async () => {
    const { catalogRepository, fixture, manager } = await makePlaylistManager({ lessonStates: ["current", "planned"] });
    const courseId = "playlist-a-lesson-1";
    await expect(manager.open(courseId)).resolves.toMatchObject({
      courseId,
      playlistContext: { playlistId: "playlist-a", lessonOrder: 1 },
    });
    const service = await manager.serviceFor(courseId);
    const state = await service.loadState();
    state.lifecycleStatus = "complete";
    state.status = "completed";
    state.cursor = service.course.units.length;
    state.completedUnitIds = service.course.units.map(({ id }) => id);
    state.activeUnitIds = [];
    state.activeQuestionUnitIds = [];
    state.activeQuestionUnitId = null;

    await service.persistAndView(state);

    expect((await catalogRepository.get(courseId)).archived).toBe(false);
    expect(await manager.open(courseId)).toMatchObject({ kind: "outline", outline: { playlistId: "playlist-a" } });
    expect(fixture.roadmap.id).toBe("playlist-a");
  });

  it("reloads an updated video package and blocks saves from its stale service", async () => {
    const { manager, root } = await makePlaylistManager({ lessonStates: ["current"] });
    const courseId = "playlist-a-lesson-1";
    const stale = await manager.serviceFor(courseId);
    const coursePath = path.join(root, "courses", courseId, "course.json");
    const memoryPath = path.join(root, "courses", courseId, "learning_memory.md");
    const memoryStore = new LearningMemoryStore(memoryPath);
    const originalCourse = JSON.parse(await fs.readFile(coursePath, "utf8"));
    const changedCourse = { ...originalCourse, contentVersion: 2, title: "Обновлённая версия" };
    await fs.writeFile(coursePath, JSON.stringify(changedCourse), "utf8");
    const beforeStaleWrite = await fs.readFile(memoryPath);

    await expect(manager.serviceFor(courseId)).rejects.toMatchObject({ category: "course-unavailable" });
    expect(await fs.readFile(memoryPath)).toEqual(beforeStaleWrite);
    await expect(stale.skipQuestions()).rejects.toMatchObject({ category: "course-unavailable" });
    expect(await fs.readFile(memoryPath)).toEqual(beforeStaleWrite);

    const migratedState = await memoryStore.load();
    await memoryStore.save({ ...migratedState, contentVersion: 2 });
    const refreshed = await manager.serviceFor(courseId);
    expect(refreshed).not.toBe(stale);
    expect(refreshed.course).toMatchObject({ contentVersion: 2, title: "Обновлённая версия" });
    expect(await refreshed.getPlaylistLessonSnapshot()).toMatchObject({ contentVersion: 2, courseId });
  });

  it("isolates broken subtitles and non-video packages to their playlist lessons", async () => {
    const { fixture, manager, root } = await makePlaylistManager({ lessonStates: ["current", "current", "current"] });
    const brokenCourseId = "playlist-a-lesson-1";
    const wrongKindCourseId = "playlist-a-lesson-2";
    const validCourseId = "playlist-a-lesson-3";
    const brokenAsset = fixture.coursesById.get(brokenCourseId).videoSource.chapters[0].subtitleAsset.fileName;
    await fs.writeFile(path.join(root, "courses", brokenCourseId, "assets", brokenAsset), "WEBVTT\ncorrupted");
    const textCourse = { ...makeUniversalCourse(), id: wrongKindCourseId, title: "Не видео" };
    await fs.writeFile(path.join(root, "courses", wrongKindCourseId, "course.json"), JSON.stringify(textCourse), "utf8");

    expect(await manager.readPlaylistLesson(brokenCourseId)).toMatchObject({ availability: "unavailable", courseId: brokenCourseId });
    expect(await manager.readPlaylistLesson(wrongKindCourseId)).toMatchObject({ availability: "unavailable", courseId: wrongKindCourseId });
    expect(await manager.readPlaylistLesson(validCourseId)).toMatchObject({ availability: "available", courseId: validCourseId });
  });
});
