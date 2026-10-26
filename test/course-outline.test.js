import { describe, expect, it } from "vitest";
import { API_VERSION } from "../src/app-identity.js";
import { buildCourseOutline, buildCourseRoadmapOutline } from "../src/domain/course-outline.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";
import { initializeActiveBlock as initVideoBlock } from "../src/domain/lesson-engine.js";
import { makeVideoCourse } from "./fixtures/video-course.js";

const course = makeUniversalCourse();

describe("course outline projector", () => {
  it("projects ordered sections with completed, current, and locked units", () => {
    const state = {
      ...createInitialState(course, { cursor: 2, targetSize: 2 }),
      completedUnitIds: ["foundation-goal", "foundation-context"],
      activeUnitIds: ["foundation-constraints", "practice-plan"],
      activeQuestionUnitId: "practice-plan",
    };

    const outline = buildCourseOutline(course, state);

    expect(outline).toMatchObject({
      appId: "adaptive-codex-learning",
      apiVersion: API_VERSION,
      courseId: "sample-article",
      progress: { completed: 2, total: 7 },
    });
    expect(outline.sections.map(({ id }) => id)).toEqual(["foundation", "practice"]);
    expect(outline.sections.map(({ containsCurrent }) => containsCurrent))
      .toEqual([true, true]);
    expect(outline.sections[0].progress).toEqual({ completed: 2, total: 3 });
    expect(outline.sections.flatMap(({ units }) => units.map(({ status }) => status)))
      .toEqual([
        "completed",
        "completed",
        "current",
        "current",
        "locked",
        "locked",
        "locked",
      ]);
  });

  it("returns only navigation metadata", () => {
    const outline = buildCourseOutline(course, createInitialState(course));
    const text = JSON.stringify(outline);

    for (const forbidden of [
      "coreText",
      "check",
      "correct",
      "explanations",
      "activity",
      "application",
      "sourceRefs",
      "sourceArtifacts",
      "coverage",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("rejects unnormalized overlapping membership", () => {
    const state = {
      ...createInitialState(course),
      activeUnitIds: ["foundation-goal"],
      completedUnitIds: ["foundation-goal"],
    };

    expect(() => buildCourseOutline(course, state))
      .toThrow("Outline state contains overlapping units");
  });
});

describe("Video course outline", () => {
  it("shows planned YouTube chapters without exposing units", () => {
    const course = makeVideoCourse();
    const state = initVideoBlock(course, createInitialState(course));
    const outline = buildCourseOutline(course, state);
    expect(outline.prepared).toEqual({ completed: 0, total: 1 });
    expect(outline.chapterPreparation).toEqual({ ready: 1, total: 2 });
    expect(outline.sections[0].units.map(({ status }) => status))
      .toEqual(["current", "planned"]);
    expect(outline.sections[0].units[1]).not.toHaveProperty("unitId");
  });
});

describe("course roadmap outline", () => {
  it("projects only titles, links, and safe availability states", () => {
    const roadmap = {
      id: "agent-workflow",
      title: "Агенты",
      sections: [{
        id: "module-one",
        title: "Модуль 1",
        order: 1,
        items: [
          { id: "introduction", title: "Введение", order: 1, courseId: "intro-course" },
          { id: "chapter-one", title: "Глава 1", order: 2, courseId: "chapter-one-course" },
          { id: "chapter-two", title: "Глава 2", order: 3 },
        ],
      }],
    };
    const summaries = new Map([
      ["intro-course", { lifecycleStatus: "complete" }],
      ["chapter-one-course", { lifecycleStatus: "in-progress" }],
    ]);

    const outline = buildCourseRoadmapOutline(roadmap, summaries, "chapter-one-course");

    expect(outline.progress).toEqual({ completed: 1, prepared: 2, total: 3 });
    expect(outline.sections[0].items).toEqual([
      { id: "introduction", title: "Введение", order: 1, status: "completed", courseId: "intro-course" },
      { id: "chapter-one", title: "Глава 1", order: 2, status: "current", courseId: "chapter-one-course" },
      { id: "chapter-two", title: "Глава 2", order: 3, status: "planned" },
    ]);
    expect(JSON.stringify(outline)).not.toContain("coreText");
  });
});
