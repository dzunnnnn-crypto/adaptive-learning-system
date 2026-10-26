import { describe, expect, it } from "vitest";
import {
  selectRenderableCourseArtifacts,
} from "../src/content/renderable-course-artifacts.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

describe("renderable course artifact view", () => {
  it("returns referenced v5 artifacts once in unit reference order", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    course.units[1].artifactRefs.unshift("figure-foundation-map");
    const result = selectRenderableCourseArtifacts(course, course.units.slice(0, 2));

    expect(result.map(({ id }) => id)).toEqual([
      "figure-foundation-map",
      "table-foundation-summary",
    ]);
    expect(result[0]).toEqual({
      id: "figure-foundation-map",
      kind: "figure",
      caption: "Карта основы курса.",
      content: course.sourceArtifacts[0].content,
    });
    expect(result[0]).not.toHaveProperty("unitIds");
    expect(result[0]).not.toHaveProperty("sourceHeading");
    expect(result[0]).not.toHaveProperty("coverage");
    expect(result[0]).not.toHaveProperty("exclusionReason");
  });

  it("returns referenced schema v6 file artifacts", () => {
    const course = makeUniversalCourse({ withFileArtifacts: true });
    const result = selectRenderableCourseArtifacts(course, course.units.slice(0, 2));

    expect(result.map(({ id }) => id)).toEqual([
      "figure-animated-demo",
      "video-demo",
    ]);
    expect(result[1]).toMatchObject({
      kind: "video",
      content: {
        type: "file",
        presentation: "video",
        mimeType: "video/webm",
      },
    });
  });

  it("returns no renderable content for schema v4", () => {
    const course = makeUniversalCourse({ schemaVersion: 4, withArtifacts: true });
    expect(selectRenderableCourseArtifacts(course, course.units)).toEqual([]);
  });
});
