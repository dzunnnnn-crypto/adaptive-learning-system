import { describe, expect, it } from "vitest";
import { createInitialState, normalizeLearningState } from "../src/domain/lesson-state.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

describe("universal learning state", () => {
  it("creates a fresh version-four state from the active course", () => {
    const course = makeUniversalCourse({ contentVersion: 2 });
    const state = createInitialState(course, { targetSize: 3 });

    expect(state).toMatchObject({
      version: 4,
      courseId: "sample-article",
      contentVersion: 2,
      lifecycleStatus: "new",
      cursor: 0,
      targetSize: 3,
      completedUnitIds: [],
      activityHistory: [],
    });
  });

  it("preserves a requested target size above five", () => {
    const course = makeUniversalCourse({ contentVersion: 2 });
    const state = createInitialState(course, { targetSize: 7 });

    expect(state.targetSize).toBe(7);
    expect(normalizeLearningState({ ...state, targetSize: 6 }, course).targetSize).toBe(6);
  });

  it("rejects a state that belongs to another course instead of resetting it silently", () => {
    const course = makeUniversalCourse({ contentVersion: 2 });
    const incompatible = {
      version: 2,
      courseId: "old-course",
      cursor: 4,
      targetSize: 4,
      completedUnitIds: ["old-unit"],
    };

    expect(() => normalizeLearningState(incompatible, course))
      .toThrow("Learning state is incompatible with the active course");
  });

  it("keeps a compatible version-four state intact", () => {
    const course = makeUniversalCourse({ contentVersion: 2 });
    const state = {
      ...createInitialState(course, { cursor: 2, targetSize: 4 }),
      completedUnitIds: ["foundation-goal", "foundation-context"],
      clarificationThread: {
        courseId: course.id,
        cursor: 2,
        messages: [{ role: "user", text: "Почему?" }],
      },
    };

    expect(normalizeLearningState(state, course)).toMatchObject({
      cursor: 2,
      targetSize: 4,
      completedUnitIds: ["foundation-goal", "foundation-context"],
      clarificationThread: { messages: [{ role: "user", text: "Почему?" }] },
    });
  });

  it("defaults a missing activity history for a compatible version-four state", () => {
    const course = makeUniversalCourse({ contentVersion: 2 });
    const state = createInitialState(course);
    delete state.activityHistory;

    expect(normalizeLearningState(state, course).activityHistory).toEqual([]);
  });

  it("migrates an unanswered legacy multi-fragment block to its first question", () => {
    const course = makeUniversalCourse();
    const legacy = {
      ...createInitialState(course, { targetSize: 3 }),
      activeUnitIds: ["foundation-goal", "foundation-context", "foundation-constraints"],
      activeQuestionUnitId: "foundation-constraints",
    };
    delete legacy.activeQuestionUnitIds;
    delete legacy.activeQuestionIndex;

    expect(normalizeLearningState(legacy, course)).toMatchObject({
      activeQuestionUnitIds: ["foundation-goal", "foundation-context", "foundation-constraints"],
      activeQuestionIndex: 0,
      activeQuestionUnitId: "foundation-goal",
    });
  });

  it("keeps an active unit current when stale completed data overlaps it", () => {
    const course = makeUniversalCourse();
    const state = {
      ...createInitialState(course),
      activeUnitIds: ["foundation-context"],
      activeQuestionUnitId: "foundation-context",
      completedUnitIds: ["foundation-goal", "foundation-context"],
    };

    expect(normalizeLearningState(state, course)).toMatchObject({
      activeUnitIds: ["foundation-context"],
      completedUnitIds: ["foundation-goal"],
    });
  });

  it("compacts legacy consecutive context markers while normalizing", () => {
    const course = makeUniversalCourse({ contentVersion: 2 });
    const state = {
      ...createInitialState(course, { targetSize: 3 }),
      clarificationThread: {
        courseId: course.id,
        cursor: 0,
        messages: [
          { role: "user", text: "Почему?" },
          { role: "assistant", text: "Потому что." },
          { role: "context-change", fromUnitIds: ["foundation-goal"], toUnitIds: ["foundation-goal", "foundation-context"], createdAt: "2026-07-19T20:01:00.000Z" },
          { role: "context-change", fromUnitIds: ["foundation-goal", "foundation-context"], toUnitIds: ["foundation-goal", "foundation-context", "foundation-constraints"], createdAt: "2026-07-19T20:02:00.000Z" },
        ],
      },
    };

    expect(normalizeLearningState(state, course).clarificationThread.messages)
      .toEqual([
        { role: "user", text: "Почему?" },
        { role: "assistant", text: "Потому что." },
        {
          role: "context-change",
          fromUnitIds: ["foundation-goal"],
          toUnitIds: ["foundation-goal", "foundation-context", "foundation-constraints"],
          createdAt: "2026-07-19T20:02:00.000Z",
        },
      ]);
  });
});
