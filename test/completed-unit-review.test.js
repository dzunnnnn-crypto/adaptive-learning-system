import { describe, expect, it } from "vitest";
import { API_VERSION } from "../src/app-identity.js";
import {
  buildCompletedUnitReview,
} from "../src/domain/completed-unit-review.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { makeFormattedCourse, makeUniversalCourse } from "./fixtures/universal-course.js";

describe("completed unit review", () => {
  it("returns one completed unit and only its renderable artifacts", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    const state = {
      ...createInitialState(course, { cursor: 1 }),
      completedUnitIds: ["foundation-goal"],
      activeUnitIds: ["foundation-context"],
    };
    const review = buildCompletedUnitReview(course, state, "foundation-goal");

    expect(review).toMatchObject({
      appId: "adaptive-codex-learning",
      apiVersion: API_VERSION,
      courseId: "sample-article",
      section: { id: "foundation", title: "Основа" },
      unit: {
        id: "foundation-goal",
        title: "Фрагмент 1",
        coreText: expect.any(String),
      },
    });
    expect(review.sourceArtifacts.map(({ id }) => id))
      .toEqual(["figure-foundation-map"]);
    expect(review.unit).not.toHaveProperty("check");
    expect(JSON.stringify(review)).not.toContain('"correct"');
  });

  it.each(["foundation-context", "practice-plan"])(
    "denies current or locked unit %s",
    (unitId) => {
      const course = makeUniversalCourse();
      const state = {
        ...createInitialState(course, { cursor: 1 }),
        completedUnitIds: ["foundation-goal"],
        activeUnitIds: ["foundation-context"],
      };
      let error;
      try {
        buildCompletedUnitReview(course, state, unitId);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ category: "review-unit-forbidden" });
    },
  );

  it("returns semantic blocks for a completed schemaVersion 8 unit", () => {
    const course = makeFormattedCourse();
    const state = {
      ...createInitialState(course, { cursor: 1 }),
      completedUnitIds: ["foundation-goal"],
      activeUnitIds: ["foundation-context"],
    };
    const review = buildCompletedUnitReview(course, state, "foundation-goal");

    expect(review.unit).toMatchObject({
      id: "foundation-goal",
      contentBlocks: expect.any(Array),
    });
    expect(review.unit).not.toHaveProperty("coreText");
    expect(review.sourceArtifacts.map(({ id }) => id)).toEqual(["figure-foundation-map"]);
  });

  it("distinguishes an unknown unit without exposing course data", () => {
    const course = makeUniversalCourse();
    let error;
    try {
      buildCompletedUnitReview(
        course,
        createInitialState(course),
        "missing-unit",
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ category: "review-unit-not-found" });
  });
});
