import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CourseSchema } from "../src/domain/course-schema.js";
import { makeFormattedCourse, makeUniversalCourse } from "./fixtures/universal-course.js";

describe("CourseSchema", () => {
  it("accepts an article-agnostic course with source coverage", () => {
    const result = CourseSchema.parse(makeUniversalCourse());

    expect(result.units).toHaveLength(7);
    expect(result.units[0].id).toBe("foundation-goal");
  });

  it("rejects a unit that is not covered by the source outline", () => {
    const uncovered = makeUniversalCourse();
    uncovered.coverage[0].unitIds = uncovered.coverage[0].unitIds.slice(1);

    expect(() => CourseSchema.parse(uncovered)).toThrow("Unit is not covered");
  });

  it("rejects an unknown coverage unit", () => {
    const unknown = makeUniversalCourse();
    unknown.coverage[0].unitIds.push("missing-unit");

    expect(() => CourseSchema.parse(unknown)).toThrow("Unknown coverage unit");
  });

  it("accepts a complete course", () => {
    const result = CourseSchema.parse(makeUniversalCourse());

    expect(result.units[0].check.correct).toBe("А");
  });

  it("accepts an optional prepared activity", () => {
    const result = CourseSchema.parse(makeUniversalCourse({ withActivity: true }));

    expect(result.schemaVersion).toBe(3);
    expect(result.units[0].activity.instructions).toHaveLength(2);
  });

  it("rejects a prepared activity without instructions", () => {
    const invalid = makeUniversalCourse({ withActivity: true });
    invalid.units[0].activity.instructions = [];

    expect(() => CourseSchema.parse(invalid)).toThrow();
  });

  it("rejects choices without Russian letters", () => {
    const invalid = makeUniversalCourse();
    invalid.units[0].check.choices = { A: "One", B: "Two", C: "Three" };

    expect(() => CourseSchema.parse(invalid)).toThrow();
  });

  it("rejects a unit that references an unknown section", () => {
    const invalid = makeUniversalCourse();
    invalid.units[0].sectionId = "unknown-section";

    expect(() => CourseSchema.parse(invalid)).toThrow("Unknown section id");
  });

  it("rejects duplicate or unordered sections", () => {
    const invalid = makeUniversalCourse();
    invalid.sections.push({ ...invalid.sections[0], order: 3 });

    expect(() => CourseSchema.parse(invalid)).toThrow();
  });

  it("keeps the future-article template structurally valid but inactive", async () => {
    const template = JSON.parse(await fs.readFile("content/templates/article-template.json", "utf8"));
    const result = CourseSchema.parse(template);

    expect(result.schemaVersion).toBe(8);
    expect(result.source.status).toBe("needs-review");
    expect(result.source.artifactAudit).toEqual({ status: "verified", artifactCount: 1 });
    expect(result.contentVersion).toBe(1);
    expect(result.sourceArtifacts[0].content.type).toBe("table");
    expect(result.units[0].contentBlocks.map(({ type }) => type))
      .toEqual(["paragraph", "callout", "artifact"]);
  });

  it("accepts a schemaVersion 8 course with semantic content blocks", () => {
    const result = CourseSchema.parse(makeFormattedCourse());

    expect(result.schemaVersion).toBe(8);
    expect(result.units[0].coreText).toBeUndefined();
    expect(result.units[0].contentBlocks[2]).toMatchObject({
      type: "artifact",
      artifactRef: "figure-foundation-map",
    });
  });

  it("rejects a schemaVersion 8 artifact that is not placed in the lesson body", () => {
    const invalid = makeFormattedCourse();
    invalid.units[0].contentBlocks = invalid.units[0].contentBlocks
      .filter((block) => block.type !== "artifact");

    expect(() => CourseSchema.parse(invalid))
      .toThrow("SchemaVersion 8 artifact blocks must match artifactRefs in order");
  });

  it("rejects a schemaVersion 8 course without a verified format audit", () => {
    const invalid = makeFormattedCourse();
    delete invalid.source.formatAudit;

    expect(() => CourseSchema.parse(invalid))
      .toThrow("SchemaVersion 8 requires a verified format audit");
  });

  it("rejects a format audit entry that was flattened from the lesson body", () => {
    const invalid = makeFormattedCourse();
    invalid.source.formatAudit.entries.find((entry) => entry.kind === "callout").kind = "quote";

    expect(() => CourseSchema.parse(invalid))
      .toThrow("Format audit entry is not represented in contentBlocks");
  });

  it("rejects contentBlocks in legacy course schemas", () => {
    const invalid = makeUniversalCourse();
    invalid.units[0].contentBlocks = [{
      type: "paragraph",
      runs: [{ type: "text", text: "Неожиданная структура." }],
    }];

    expect(() => CourseSchema.parse(invalid))
      .toThrow("Legacy unit requires coreText without contentBlocks");
  });

  it("keeps the future YouTube chapter template structurally valid but inactive", async () => {
    const template = JSON.parse(await fs.readFile("content/templates/video-course-template.json", "utf8"));
    const result = CourseSchema.parse(template);

    expect(result.schemaVersion).toBe(7);
    expect(result.source.status).toBe("needs-review");
    expect(result.videoSource.videoId).toBe("dQw4w9WgXcQ");
    expect(result.videoSource.chapters.map(({ status }) => status)).toEqual(["ready", "planned"]);
    expect(result.units[0].checks).toHaveLength(3);
  });

  it("accepts a schemaVersion 4 course with bidirectional artifacts", () => {
    const result = CourseSchema.parse(makeUniversalCourse({ schemaVersion: 4, withArtifacts: true }));

    expect(result.schemaVersion).toBe(4);
    expect(result.sourceArtifacts).toHaveLength(1);
    expect(result.units[0].artifactRefs).toEqual(["table-foundation-summary"]);
  });

  it("rejects a schemaVersion 4 course without source artifacts", () => {
    expect(() => CourseSchema.parse(makeUniversalCourse({ schemaVersion: 4 })))
      .toThrow("Source artifacts are required");
  });

  it("rejects an excluded artifact that still references units", () => {
    const invalid = makeUniversalCourse({ schemaVersion: 4, withArtifacts: true });
    invalid.sourceArtifacts[0].coverage = "excluded";

    expect(() => CourseSchema.parse(invalid)).toThrow("Artifact coverage invariant violated");
  });

  it("rejects an artifact that references an unknown unit", () => {
    const invalid = makeUniversalCourse({ schemaVersion: 4, withArtifacts: true });
    invalid.sourceArtifacts[0].unitIds = ["missing-unit"];

    expect(() => CourseSchema.parse(invalid)).toThrow("Unknown artifact unit");
  });

  it("still accepts a schemaVersion 3 course without artifacts", () => {
    const result = CourseSchema.parse(makeUniversalCourse());

    expect(result.schemaVersion).toBe(3);
    expect(result.sourceArtifacts).toBeUndefined();
  });

  it("accepts all renderable artifact kinds in schemaVersion 5", () => {
    const result = CourseSchema.parse(makeUniversalCourse({ withRenderableArtifacts: true }));

    expect(result.schemaVersion).toBe(5);
    expect(result.sourceArtifacts.map(({ content }) => content.type))
      .toEqual(["image", "table", "code", "formula"]);
  });

  it("keeps schemaVersion 4 metadata-only artifacts valid", () => {
    expect(() => CourseSchema.parse(
      makeUniversalCourse({ schemaVersion: 4, withArtifacts: true }),
    )).not.toThrow();
  });

  it("allows a schemaVersion 5 source with a verified empty artifact audit", () => {
    const course = makeUniversalCourse();
    course.schemaVersion = 5;
    course.sourceArtifacts = [];
    course.source.artifactAudit = { status: "verified", artifactCount: 0 };

    expect(() => CourseSchema.parse(course)).not.toThrow();
  });

  it("rejects a schemaVersion 5 source without a verified artifact audit", () => {
    const course = makeUniversalCourse();
    course.schemaVersion = 5;
    course.sourceArtifacts = [];

    expect(() => CourseSchema.parse(course)).toThrow("Source artifact audit is required");
  });

  it("rejects a schemaVersion 5 artifact count that differs from the audit", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    course.source.artifactAudit.artifactCount = 3;

    expect(() => CourseSchema.parse(course)).toThrow("Source artifact audit count does not match");
  });

  it("rejects a covered schemaVersion 5 artifact without content", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    delete course.sourceArtifacts[0].content;

    expect(() => CourseSchema.parse(course)).toThrow("Renderable artifact content is required");
  });

  it("rejects a schemaVersion 5 kind and content mismatch", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    course.sourceArtifacts[0].content = { type: "formula", text: "unsafe mismatch" };

    expect(() => CourseSchema.parse(course)).toThrow("Artifact kind does not match content type");
  });

  it("rejects unequal schemaVersion 5 table row widths", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    course.sourceArtifacts[1].content.rows[0] = ["only one cell"];

    expect(() => CourseSchema.parse(course)).toThrow("Table rows must match column count");
  });

  it("rejects unequal schemaVersion 5 table alignment widths", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    course.sourceArtifacts[1].content.align = ["left"];

    expect(() => CourseSchema.parse(course)).toThrow("Table alignment must match column count");
  });

  it("rejects duplicate artifact references inside one unit", () => {
    const course = makeUniversalCourse({ withRenderableArtifacts: true });
    course.units[0].artifactRefs.push("figure-foundation-map");

    expect(() => CourseSchema.parse(course)).toThrow("Duplicate artifact reference");
  });

  it("accepts every schemaVersion 6 file presentation", () => {
    const result = CourseSchema.parse(makeUniversalCourse({ withFileArtifacts: true }));
    expect(result.schemaVersion).toBe(6);
    expect(result.sourceArtifacts.map(({ content }) => content.presentation))
      .toEqual(["image", "video", "audio", "pdf", "download"]);
  });

  it("rejects schemaVersion 6 kind and presentation mismatches", () => {
    const course = makeUniversalCourse({ withFileArtifacts: true });
    course.sourceArtifacts[1].kind = "audio";
    expect(() => CourseSchema.parse(course)).toThrow("Artifact kind does not match file presentation");
  });

  it("rejects file content in schemaVersion 5", () => {
    const course = makeUniversalCourse({ withFileArtifacts: true });
    course.schemaVersion = 5;
    expect(() => CourseSchema.parse(course)).toThrow("File content requires schemaVersion 6");
  });

 it("rejects unsafe file metadata", () => {
   const course = makeUniversalCourse({ withFileArtifacts: true });
   course.sourceArtifacts[4].content.fileName = "../examples.zip";
   expect(() => CourseSchema.parse(course)).toThrow();
 });

  it("rejects correct key not matching the Верно explanation", () => {
    const course = makeUniversalCourse();
    course.units[0].check.explanations = {
      "А": "Верно: правильный ответ.",
      "Б": "Неверно: неточное утверждение.",
      "В": "Неверно: неверное утверждение.",
    };
    course.units[0].check.correct = "Б";
    expect(() => CourseSchema.parse(course)).toThrow("Correct key does not match the Верно explanation");
  });

  it("accepts correct key matching the Верно explanation", () => {
    const course = makeUniversalCourse();
    course.units[0].check.explanations = {
      "А": "Верно: правильный ответ.",
      "Б": "Неверно: неточное утверждение.",
      "В": "Неверно: неверное утверждение.",
    };
    course.units[0].check.correct = "А";
    expect(() => CourseSchema.parse(course)).not.toThrow();
  });

  it("skips Верно check for courses without the convention", () => {
    const course = makeUniversalCourse();
    expect(() => CourseSchema.parse(course)).not.toThrow();
  });
});
