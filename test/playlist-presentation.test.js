import { describe, expect, it } from "vitest";
import { buildPlaylistPresentation } from "../src/domain/playlist-presentation.js";
import { makePlaylistFixture } from "./fixtures/playlist.js";
import { buildVisibleLibraryItems } from "../public/playlist-library.js";

function present(fixture, overrides = {}) {
  return buildPlaylistPresentation({
    roadmap: fixture.roadmap,
    lessonSnapshots: fixture.lessonSnapshots,
    catalogEntries: fixture.catalogEntries,
    navigation: fixture.navigation,
    globalLastCourseId: fixture.globalLastCourseId,
    ...overrides,
  });
}

describe("buildPlaylistPresentation", () => {
  it("counts only complete videos against the full route and marks chapters by unit ID", () => {
    const fixture = makePlaylistFixture({ id: "fixture", lessonStates: ["completed", "current", "planned"] });
    const before = JSON.stringify([...fixture.lessonSnapshots]);
    const result = present(fixture);
    const currentLesson = result.outline.sections[0].lessons[1];
    const chapter = currentLesson.chapters[1];

    expect(result.card.progress).toMatchObject({ completed: 1, total: 3, prepared: 2 });
    expect(result.card.progress.ratio).toBeCloseTo(1 / 3);
    expect(result.resumeCourseId).toBe("fixture-lesson-2");
    expect(result.card.current).toMatchObject({ courseId: "fixture-lesson-2", chapterNumber: 2, chapterTotal: 2 });
    expect(chapter).toMatchObject({ id: "source-chapter-02", unitId: "chapter-02", status: "current" });
    expect(JSON.stringify([...fixture.lessonSnapshots])).toBe(before);
  });

  it("uses saved playlist navigation before the global last course", () => {
    const fixture = makePlaylistFixture({ id: "fixture", lessonStates: ["new", "current", "planned"] });
    fixture.navigation = { lastLessonCourseId: "fixture-lesson-2", lastOpenedAt: "2026-10-12T10:00:00.000Z", archived: false };
    fixture.globalLastCourseId = "fixture-lesson-1";
    expect(present(fixture).resumeCourseId).toBe("fixture-lesson-2");
  });

  it("sorts last-use timestamps by instant when offsets differ", () => {
    const fixture = makePlaylistFixture({ id: "fixture", lessonStates: ["completed", "current"] });
    fixture.navigation = { lastLessonCourseId: "fixture-lesson-2", lastOpenedAt: "2026-10-12T12:00:00+03:00", archived: false };
    fixture.lessonSnapshots.get("fixture-lesson-1").updatedAt = "2026-10-12T08:30:00.000Z";
    expect(present(fixture).card.updatedAt).toBe("2026-10-12T12:00:00+03:00");
  });

  it("waits for planned chapters and never exposes transcript or lesson bodies", () => {
    const fixture = makePlaylistFixture({ id: "fixture", lessonStates: ["waiting-content", "planned"] });
    const firstCourseId = "fixture-lesson-1";
    fixture.lessonSnapshots.get(firstCourseId).transcript = "private-transcript-marker";
    fixture.lessonSnapshots.get(firstCourseId).coreText = "private-lesson-body-marker";
    const result = present(fixture);

    expect(result.card.progress).toMatchObject({ completed: 0, total: 2, prepared: 0, partial: 1 });
    expect(result.outline.sections[0].lessons[0].status).toBe("waiting-content");
    expect(JSON.stringify(result.outline)).not.toContain("private-transcript-marker");
    expect(JSON.stringify(result.outline)).not.toContain("private-lesson-body-marker");
  });

  it("does not resume a finished last lesson automatically", () => {
    const fixture = makePlaylistFixture({ id: "fixture", lessonStates: ["completed", "planned"] });
    const result = present(fixture);
    expect(result.resumeCourseId).toBeNull();
    expect(result.card.current).toBeNull();
  });

  it("links an archived completed lesson and a started second lesson without changing their state", () => {
    const fixture = makePlaylistFixture({
      id: "kiselev",
      lessonStates: ["completed", "current", "planned"],
    });
    fixture.navigation = null;
    fixture.globalLastCourseId = "kiselev-lesson-2";
    fixture.catalogEntries[0].archived = true;
    const second = fixture.lessonSnapshots.get("kiselev-lesson-2");
    second.chapters = Array.from({ length: 11 }, (_value, index) => {
      const order = index + 1;
      const suffix = String(order).padStart(2, "0");
      return {
        id: `source-chapter-${suffix}`,
        unitId: `chapter-${suffix}`,
        title: `УРОК 2, глава ${order}`,
        order,
        status: order <= 3 ? "completed" : order === 4 ? "current" : "locked",
      };
    });
    second.completedUnitIds = ["chapter-01", "chapter-02", "chapter-03"];
    second.activeUnitIds = ["chapter-04"];
    second.cursor = 3;
    second.lifecycleStatus = "new";
    second.hasLearningActivity = true;
    const secondState = fixture.statesById.get("kiselev-lesson-2");
    secondState.completedUnitIds = [...second.completedUnitIds];
    secondState.activeUnitIds = [...second.activeUnitIds];
    secondState.cursor = 3;
    secondState.answerHistory = Array.from({ length: 9 }, (_value, index) => ({
      questionId: `answer-${index + 1}`,
      choice: ["А", "Б", "В"][index % 3],
      correct: true,
    }));
    const before = JSON.stringify({ roadmap: fixture.roadmap, catalog: fixture.catalogEntries, snapshots: [...fixture.lessonSnapshots], state: secondState });
    const result = present(fixture);
    const firstOutline = result.outline.sections[0].lessons[0];
    const visibleItems = buildVisibleLibraryItems({
      lastCourseId: fixture.globalLastCourseId,
      courses: fixture.catalogEntries.map((entry) => ({
        ...entry,
        lifecycleStatus: entry.id === "kiselev-lesson-1" ? "complete" : "in-progress",
        completedUnits: entry.id === "kiselev-lesson-1" ? 8 : 3,
        totalUnits: entry.id === "kiselev-lesson-1" ? 8 : 11,
        progress: entry.id === "kiselev-lesson-1" ? 1 : 3 / 11,
      })),
      playlists: [result.card],
    });
    const beforeLibraryRead = JSON.stringify({ roadmap: fixture.roadmap, catalog: fixture.catalogEntries, snapshots: [...fixture.lessonSnapshots], state: secondState });

    expect(result.card.progress).toMatchObject({ completed: 1, total: 3, prepared: 2 });
    expect(result.card.archived).toBe(false);
    expect(result.resumeCourseId).toBe("kiselev-lesson-2");
    expect(result.card.current).toMatchObject({ courseId: "kiselev-lesson-2", chapterNumber: 4, chapterTotal: 11 });
    expect(firstOutline.status).toBe("completed");
    expect(visibleItems.filter(({ kind }) => kind === "youtube-playlist")).toHaveLength(1);
    expect(visibleItems.filter(({ kind }) => kind === "course")).toHaveLength(0);
    expect(beforeLibraryRead).toBe(before);
  });

  it("isolates unavailable lessons and retains stable IDs for duplicate titles", () => {
    const fixture = makePlaylistFixture({ id: "fixture", lessonStates: ["new", "current", "planned"] });
    fixture.roadmap.sections[0].items.forEach((item) => { item.title = "Одинаковое название"; });
    fixture.lessonSnapshots.set("fixture-lesson-2", {
      availability: "unavailable",
      courseId: "fixture-lesson-2",
      reason: "Subtitle integrity check failed",
    });
    const result = present(fixture);

    expect(result.resumeCourseId).toBeNull();
    expect(result.outline.sections[0].lessons.map(({ id }) => id)).toEqual(["lesson-1", "lesson-2", "lesson-3"]);
    expect(result.outline.sections[0].lessons[1]).toMatchObject({ status: "unavailable", reason: "Subtitle integrity check failed" });
    expect(result.card.lifecycleStatus).toBe("unavailable");
  });
});
