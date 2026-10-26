import { describe, expect, it } from "vitest";
import { CourseSchema } from "../src/domain/course-schema.js";
import { makeVideoCourse } from "./fixtures/video-course.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

describe("Video course schema (schemaVersion 7)", () => {
  it("accepts one ready and one planned YouTube chapter", () => {
    const course = CourseSchema.parse(makeVideoCourse());
    expect(course.schemaVersion).toBe(7);
    expect(course.videoSource.chapters.map(({ status }) => status))
      .toEqual(["ready", "planned"]);
    expect(course.units[0].checks).toHaveLength(3);
  });

  it("rejects overlapping YouTube chapters", () => {
    const course = makeVideoCourse();
    course.videoSource.chapters[1].startSeconds = 352;
    expect(() => CourseSchema.parse(course)).toThrow("Video chapters must not overlap");
  });

  it("rejects a planned chapter with a unitId", () => {
    const course = makeVideoCourse();
    course.videoSource.chapters[1].unitId = "introduction";
    expect(() => CourseSchema.parse(course)).toThrow("Planned chapter cannot expose a unit");
  });

  it("keeps schemaVersion 3 through 6 compatible", () => {
    for (const course of [
      makeUniversalCourse(),
      makeUniversalCourse({ schemaVersion: 4, withArtifacts: true }),
      makeUniversalCourse({ withRenderableArtifacts: true }),
      makeUniversalCourse({ withFileArtifacts: true }),
    ]) {
      expect(() => CourseSchema.parse(course)).not.toThrow();
    }
  });
});
