import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseRoadmapRepository } from "../src/content/course-roadmap-repository.js";
import { PlaylistService } from "../src/application/playlist-service.js";
import { PlaylistStateStore } from "../src/persistence/playlist-state-store.js";
import { makePlaylistFixture } from "./fixtures/playlist.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeHarness(fixtures, { failSelect = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "playlist-service-"));
  directories.push(directory);
  const roadmapsPath = path.join(directory, "roadmaps.json");
  const roadmapDocument = { schemaVersion: 1, roadmaps: fixtures.map(({ roadmap }) => roadmap) };
  await fs.writeFile(roadmapsPath, JSON.stringify(roadmapDocument), "utf8");
  const roadmapRepository = new CourseRoadmapRepository({ roadmapsPath });
  const baseNavigationStore = new PlaylistStateStore(path.join(directory, "data", "playlist-state.json"));
  const navigationStore = failSelect ? {
    get: (...args) => baseNavigationStore.get(...args),
    select: async () => { throw new Error("navigation write failed"); },
    setArchived: (...args) => baseNavigationStore.setArchived(...args),
    load: (...args) => baseNavigationStore.load(...args),
  } : baseNavigationStore;
  const lessonSnapshots = new Map();
  const catalogEntries = [];
  for (const fixture of fixtures) {
    fixture.lessonSnapshots.forEach((snapshot, courseId) => lessonSnapshots.set(courseId, snapshot));
    catalogEntries.push(...fixture.catalogEntries);
  }
  catalogEntries.forEach((entry, index) => { entry.order = index + 1; });
  const appState = { lastCourseId: null, aiProfileId: "codex-terra-medium" };
  const appStateStore = {
    load: vi.fn(async () => ({ ...appState })),
    update: vi.fn(async (patch) => Object.assign(appState, patch)),
  };
  const courseAccess = {
    listCatalogEntries: vi.fn(async () => catalogEntries),
    readLesson: vi.fn(async (courseId) => lessonSnapshots.get(courseId)
      ?? { availability: "unavailable", courseId, reason: "Fixture package missing" }),
    openLesson: vi.fn(async (courseId) => {
      await appStateStore.update({ lastCourseId: courseId });
      return { courseId, lifecycleStatus: "in-progress", units: [] };
    }),
  };
  const service = new PlaylistService({
    roadmapRepository,
    navigationStore,
    courseAccess,
    appStateStore,
    clock: () => new Date("2026-10-12T10:00:00.000Z"),
  });
  return { appStateStore, baseNavigationStore, courseAccess, directory, navigationStore, service };
}

describe("PlaylistService", () => {
  it("resumes each playlist independently after creating a new service instance", async () => {
    const fixtureA = makePlaylistFixture({ id: "playlist-a", lessonStates: ["new"] });
    const fixtureB = makePlaylistFixture({ id: "playlist-b", lessonStates: ["new"] });
    const first = await makeHarness([fixtureA, fixtureB]);
    await first.service.open("playlist-a", { lessonCourseId: "playlist-a-lesson-1" });
    await first.service.open("playlist-b", { lessonCourseId: "playlist-b-lesson-1" });

    const restarted = new PlaylistService({
      roadmapRepository: first.service.roadmapRepository,
      navigationStore: first.baseNavigationStore,
      courseAccess: first.courseAccess,
      appStateStore: first.appStateStore,
      clock: () => new Date("2026-10-12T10:00:00.000Z"),
    });
    const reopenedA = await restarted.open("playlist-a");
    const reopenedB = await restarted.open("playlist-b");
    expect(reopenedA).toMatchObject({ kind: "lesson", view: { courseId: "playlist-a-lesson-1" } });
    expect(reopenedB).toMatchObject({ kind: "lesson", view: { courseId: "playlist-b-lesson-1" } });
  });

  it("returns a read-only outline for a completed last lesson", async () => {
    const fixture = makePlaylistFixture({ id: "playlist-a", lessonStates: ["completed", "planned"] });
    const { appStateStore, baseNavigationStore, courseAccess, service } = await makeHarness([fixture]);
    const beforeState = await baseNavigationStore.load();
    const result = await service.open("playlist-a");

    expect(result.kind).toBe("outline");
    expect(result.notice).toContain("завершён");
    expect(courseAccess.openLesson).not.toHaveBeenCalled();
    expect(appStateStore.update).not.toHaveBeenCalled();
    expect(await baseNavigationStore.load()).toEqual(beforeState);
  });

  it("rejects a foreign or unprepared lesson before changing navigation", async () => {
    const fixture = makePlaylistFixture({ id: "playlist-a", lessonStates: ["new", "planned"] });
    const { appStateStore, baseNavigationStore, courseAccess, service } = await makeHarness([fixture]);

    await expect(service.open("playlist-a", { lessonCourseId: "foreign-course" }))
      .rejects.toMatchObject({ category: "playlist-lesson-forbidden" });
    await expect(service.open("playlist-a", { lessonCourseId: "lesson-2" }))
      .rejects.toMatchObject({ category: "playlist-lesson-not-ready" });
    expect(appStateStore.update).not.toHaveBeenCalled();
    expect(courseAccess.openLesson).not.toHaveBeenCalled();
    await expect(baseNavigationStore.load()).resolves.toEqual({ schemaVersion: 1, playlists: {} });
  });

  it("shows a readable outline but refuses to open while navigation state is corrupt", async () => {
    const fixture = makePlaylistFixture({ id: "playlist-a", lessonStates: ["current"] });
    const { courseAccess, directory, service } = await makeHarness([fixture]);
    await fs.mkdir(path.join(directory, "data"), { recursive: true });
    await fs.writeFile(path.join(directory, "data", "playlist-state.json"), "{invalid");

    const outline = await service.outlineFor("playlist-a");
    const result = await service.open("playlist-a");

    expect(outline.navigationError).toBeTruthy();
    expect(result).toMatchObject({ kind: "outline" });
    expect(result.notice).toContain("сохранённую точку");
    expect(courseAccess.openLesson).not.toHaveBeenCalled();
  });

  it("reports a partial open when playlist navigation fails after the course opens", async () => {
    const fixture = makePlaylistFixture({ id: "playlist-a", lessonStates: ["new", "new"] });
    const failing = await makeHarness([fixture], { failSelect: true });
    await failing.baseNavigationStore.select("playlist-a", "playlist-a-lesson-1", { openedAt: "2026-10-12T09:00:00.000Z" });

    await expect(failing.service.open("playlist-a", { lessonCourseId: "playlist-a-lesson-2" }))
      .rejects.toMatchObject({ category: "playlist-navigation-partial" });
    expect(failing.appStateStore.update).toHaveBeenCalledWith({ lastCourseId: "playlist-a-lesson-2" });
    expect(await failing.baseNavigationStore.get("playlist-a")).toMatchObject({ lastLessonCourseId: "playlist-a-lesson-1" });
  });
});
