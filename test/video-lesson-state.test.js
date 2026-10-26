import { describe, expect, it } from "vitest";
import { createInitialState, normalizeLearningState } from "../src/domain/lesson-state.js";
import { makeVideoCourse } from "./fixtures/video-course.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

describe("Video learning state (version 5)", () => {
  it("creates version five only for schemaVersion 7", () => {
    const video = createInitialState(makeVideoCourse());
    const article = createInitialState(makeUniversalCourse());
    expect(video).toMatchObject({
      version: 5,
      videoProgress: {},
      questionProgress: {},
    });
    expect(article.version).toBe(4);
  });

  it("rejects a version four state for a video course", () => {
    const course = makeVideoCourse();
    expect(() => normalizeLearningState({
      ...createInitialState(course),
      version: 4,
    }, course)).toThrow("Learning state is incompatible");
  });

  it("keeps existing version four article state byte-compatible in shape", () => {
    const course = makeUniversalCourse();
    expect(createInitialState(course)).not.toHaveProperty("videoProgress");
  });
});
