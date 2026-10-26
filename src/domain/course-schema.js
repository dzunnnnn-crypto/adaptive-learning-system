import { z } from "zod";
import {
  VideoCheckSchema,
  TranscriptSchema,
  VideoSourceSchema,
  YouTubeContentSchema,
} from "./video-course-schema.js";

const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const ChoiceSchema = z.enum(["А", "Б", "В"]);

const FormatKindSchema = z.enum([
  "heading",
  "paragraph",
  "strong",
  "emphasis",
  "line-break",
  "list",
  "callout",
  "quote",
  "artifact",
]);

export const CheckSchema = z.object({
  prompt: z.string().min(10),
  choices: z.object({
    "А": z.string().min(1),
    "Б": z.string().min(1),
    "В": z.string().min(1),
  }).strict(),
  correct: ChoiceSchema,
  explanations: z.object({
    "А": z.string().min(1),
    "Б": z.string().min(1),
    "В": z.string().min(1),
  }).strict(),
}).strict();

export const ApplicationSchema = z.object({
  prompt: z.string().min(10),
  choices: z.object({
    "А": z.string().min(1),
    "Б": z.string().min(1),
    "В": z.string().min(1),
  }).strict(),
}).strict();

const FormatAuditEntrySchema = z.object({
  id: IdentifierSchema,
  sourceHeading: z.string().min(1),
  kind: FormatKindSchema,
  unitId: IdentifierSchema.optional(),
  exclusionReason: z.string().min(1).nullable(),
}).strict();

export const SourceSchema = z.object({
  title: z.string().min(3),
  url: z.string().url(),
  author: z.string().trim().min(1).max(160).optional(),
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  language: z.string().min(2),
  status: z.enum(["verified", "needs-review"]),
  artifactAudit: z.object({
    status: z.literal("verified"),
    artifactCount: z.number().int().nonnegative(),
  }).strict().optional(),
  formatAudit: z.object({
    status: z.literal("verified"),
    entries: z.array(FormatAuditEntrySchema).min(1),
  }).strict().optional(),
}).strict();

export const SectionSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(3),
  order: z.number().int().positive(),
  sourceHeading: z.string().min(1),
}).strict();

export const ActivitySchema = z.object({
  title: z.string().min(3).max(120),
  instructions: z.array(z.string().min(3).max(500)).min(1).max(8),
  expectedResult: z.string().min(10).max(1000),
  confirmationPrompt: z.string().min(10).max(500),
  projectHint: z.string().min(3).max(500).optional(),
}).strict();

const InlineRunSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(5000) }).strict(),
  z.object({ type: z.literal("strong"), text: z.string().min(1).max(5000) }).strict(),
  z.object({ type: z.literal("emphasis"), text: z.string().min(1).max(5000) }).strict(),
  z.object({ type: z.literal("line-break") }).strict(),
]);

const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  runs: z.array(InlineRunSchema).min(1),
}).strict();

const ListBlockSchema = z.object({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(z.array(InlineRunSchema).min(1)).min(1),
}).strict();

const CalloutBlockSchema = z.object({
  type: z.literal("callout"),
  tone: z.enum(["neutral", "note", "tip", "warning"]),
  label: z.string().trim().min(1).max(180).optional(),
  blocks: z.array(z.union([ParagraphBlockSchema, ListBlockSchema])).min(1),
}).strict();

const FormattedContentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(2), z.literal(3)]),
    runs: z.array(InlineRunSchema).min(1),
  }).strict(),
  ParagraphBlockSchema,
  ListBlockSchema,
  CalloutBlockSchema,
  z.object({ type: z.literal("quote"), runs: z.array(InlineRunSchema).min(1) }).strict(),
  z.object({ type: z.literal("artifact"), artifactRef: IdentifierSchema }).strict(),
]);

function runsContainKind(runs, kind) {
  return runs.some((run) => run.type === kind);
}

function blockContainsFormat(block, kind) {
  if (block.type === kind) return true;
  if (["strong", "emphasis", "line-break"].includes(kind) && block.runs) {
    return runsContainKind(block.runs, kind);
  }
  if (block.type === "list") {
    return kind === "list" || block.items.some((item) => runsContainKind(item, kind));
  }
  if (block.type === "callout") {
    return kind === "callout" || block.blocks.some((nested) => blockContainsFormat(nested, kind));
  }
  return false;
}

export const UnitSchema = z.object({
  id: IdentifierSchema,
  sectionId: IdentifierSchema,
  order: z.number().int().positive(),
  title: z.string().min(3),
  coreText: z.string().min(40).optional(),
  contentBlocks: z.array(FormattedContentBlockSchema).min(1).optional(),
  sourceRefs: z.array(IdentifierSchema).min(1),
  estimatedMinutes: z.number().int().min(1).max(20),
  check: CheckSchema.optional(),
  checks: z.array(VideoCheckSchema).optional(),
  transcript: TranscriptSchema.optional(),
  activity: ActivitySchema.optional(),
  artifactRefs: z.array(IdentifierSchema).optional(),
}).strict();

export const CoverageSchema = z.object({
  id: IdentifierSchema,
  sourceHeading: z.string().min(1),
  unitIds: z.array(IdentifierSchema).min(1),
}).strict();

const ImageContentSchema = z.object({
  type: z.literal("image"),
  fileName: z.string()
    .regex(/^[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/)
    .refine((value) => !value.includes(".."), "Unsafe image file name"),
  alt: z.string().trim().min(3).max(500),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const TableContentSchema = z.object({
  type: z.literal("table"),
  columns: z.array(z.string().min(1).max(500)).min(1),
  rows: z.array(z.array(z.string().max(2000))).min(1),
  align: z.array(z.enum(["left", "center", "right"])).min(1),
}).strict();

const CodeContentSchema = z.object({
  type: z.literal("code"),
  language: z.string().regex(/^[a-z0-9+#.-]+$/).max(30),
  text: z.string().min(1).max(30000),
}).strict();

const FormulaContentSchema = z.object({
  type: z.literal("formula"),
  text: z.string().min(1).max(5000),
}).strict();

const FileContentSchema = z.object({
  type: z.literal("file"),
  fileName: z.string()
    .min(1)
    .max(180)
    .regex(/^[a-z0-9][a-z0-9._-]*$/)
    .refine((value) => !value.includes(".."), "Unsafe asset file name"),
  originalName: z.string().trim().min(1).max(255)
    .refine((value) => !/[\\/]/u.test(value), "Unsafe original file name"),
  mimeType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i).max(120),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  presentation: z.enum(["image", "video", "audio", "pdf", "download"]),
  accessibilityText: z.string().trim().min(3).max(500),
}).strict();

const ArtifactContentSchema = z.discriminatedUnion("type", [
  ImageContentSchema,
  TableContentSchema,
  CodeContentSchema,
  FormulaContentSchema,
  FileContentSchema,
  YouTubeContentSchema,
]);

export const SourceArtifactSchema = z.object({
  id: IdentifierSchema,
  kind: z.enum(["table", "figure", "listing", "formula", "video", "audio", "document", "attachment"]),
  sourceHeading: z.string().min(1),
  caption: z.string().min(1),
  coverage: z.enum(["covered", "excluded"]),
  unitIds: z.array(IdentifierSchema),
  exclusionReason: z.string().min(1).nullable(),
  content: ArtifactContentSchema.optional(),
}).strict();

export const CourseSchema = z.object({
  schemaVersion: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  contentVersion: z.number().int().positive(),
  id: IdentifierSchema,
  title: z.string().min(3),
  source: SourceSchema,
  sections: z.array(SectionSchema).min(1),
  units: z.array(UnitSchema).min(1),
  coverage: z.array(CoverageSchema).min(1),
  sourceArtifacts: z.array(SourceArtifactSchema).optional(),
  application: ApplicationSchema.optional(),
  videoSource: VideoSourceSchema.optional(),
}).strict().superRefine((course, ctx) => {
  const sectionIds = new Set();
  course.sections.forEach((section, index) => {
    if (sectionIds.has(section.id)) {
      ctx.addIssue({ code: "custom", path: ["sections", index, "id"], message: "Duplicate section id" });
    }
    sectionIds.add(section.id);
    if (section.order !== index + 1) {
      ctx.addIssue({ code: "custom", path: ["sections", index, "order"], message: "Sections must be sequential" });
    }
  });

  const unitIds = new Set();
  course.units.forEach((unit, index) => {
    if (!sectionIds.has(unit.sectionId)) {
      ctx.addIssue({ code: "custom", path: ["units", index, "sectionId"], message: "Unknown section id" });
    }
    if (unitIds.has(unit.id)) {
      ctx.addIssue({ code: "custom", path: ["units", index, "id"], message: "Duplicate unit id" });
    }
    unitIds.add(unit.id);
    if (unit.order !== index + 1) {
      ctx.addIssue({ code: "custom", path: ["units", index, "order"], message: "Units must be sequential" });
    }
    if (course.schemaVersion === 8) {
      if (unit.coreText !== undefined || !unit.contentBlocks) {
        ctx.addIssue({ code: "custom", path: ["units", index], message: "SchemaVersion 8 unit requires contentBlocks instead of coreText" });
      }
    } else if (!unit.coreText || unit.contentBlocks) {
      ctx.addIssue({ code: "custom", path: ["units", index], message: "Legacy unit requires coreText without contentBlocks" });
    }
  });

  if (course.schemaVersion === 8) {
    if (!course.source.formatAudit) {
      ctx.addIssue({
        code: "custom",
        path: ["source", "formatAudit"],
        message: "SchemaVersion 8 requires a verified format audit",
      });
    } else {
      const formatEntryIds = new Set();
      course.source.formatAudit.entries.forEach((entry, index) => {
        if (formatEntryIds.has(entry.id)) {
          ctx.addIssue({ code: "custom", path: ["source", "formatAudit", "entries", index, "id"], message: "Duplicate format audit entry" });
        }
        formatEntryIds.add(entry.id);
        const covered = entry.unitId !== undefined && entry.exclusionReason === null;
        const excluded = entry.unitId === undefined && entry.exclusionReason !== null;
        if (!covered && !excluded) {
          ctx.addIssue({ code: "custom", path: ["source", "formatAudit", "entries", index], message: "Format audit coverage invariant violated" });
          return;
        }
        if (!entry.unitId) return;
        const unit = course.units.find((candidate) => candidate.id === entry.unitId);
        if (!unit) {
          ctx.addIssue({ code: "custom", path: ["source", "formatAudit", "entries", index, "unitId"], message: "Unknown format audit unit" });
        } else if (!unit.contentBlocks.some((block) => blockContainsFormat(block, entry.kind))) {
          ctx.addIssue({ code: "custom", path: ["source", "formatAudit", "entries", index], message: "Format audit entry is not represented in contentBlocks" });
        }
      });
    }
  }

  const coverageIds = new Set();
  const coveredUnitIds = new Set();
  const coverageById = new Map();
  course.coverage.forEach((row, index) => {
    if (coverageIds.has(row.id)) {
      ctx.addIssue({ code: "custom", path: ["coverage", index, "id"], message: "Duplicate coverage id" });
    }
    coverageIds.add(row.id);
    coverageById.set(row.id, new Set(row.unitIds));
    row.unitIds.forEach((unitId, unitIndex) => {
      if (!unitIds.has(unitId)) {
        ctx.addIssue({ code: "custom", path: ["coverage", index, "unitIds", unitIndex], message: "Unknown coverage unit" });
      }
      coveredUnitIds.add(unitId);
    });
  });

  course.units.forEach((unit, index) => {
    if (!coveredUnitIds.has(unit.id)) {
      ctx.addIssue({ code: "custom", path: ["units", index, "id"], message: "Unit is not covered" });
    }
    unit.sourceRefs.forEach((sourceRef, refIndex) => {
      const coveredBySource = coverageById.get(sourceRef);
      if (!coveredBySource) {
        ctx.addIssue({ code: "custom", path: ["units", index, "sourceRefs", refIndex], message: "Unknown source reference" });
      } else if (!coveredBySource.has(unit.id)) {
        ctx.addIssue({ code: "custom", path: ["units", index, "sourceRefs", refIndex], message: "Source reference does not cover unit" });
      }
    });
  });

  course.units.forEach((unit, index) => {
    const maxMinutes = course.schemaVersion === 7 ? 20 : 5;
    if (unit.estimatedMinutes > maxMinutes) {
      ctx.addIssue({ code: "custom", path: ["units", index, "estimatedMinutes"], message: `Estimated minutes must be at most ${maxMinutes}` });
    }
  });

  if (course.schemaVersion === 7) {
    if (!course.videoSource) {
      ctx.addIssue({ code: "custom", path: ["videoSource"], message: "Video source is required" });
    }
    if (course.application) {
      ctx.addIssue({ code: "custom", path: ["application"], message: "Video course does not use final application" });
    }
    course.units.forEach((unit, index) => {
      if (unit.check || unit.checks?.length !== 3
        || (course.videoSource?.materialMode !== "embedded-only" && !unit.transcript)) {
        ctx.addIssue({ code: "custom", path: ["units", index], message: "Video unit requires transcript and exactly three checks" });
      }
      if (course.videoSource?.materialMode === "embedded-only" && unit.transcript) {
        ctx.addIssue({ code: "custom", path: ["units", index, "transcript"], message: "Embedded-only courses cannot bundle transcripts" });
      }
      if (unit.checks) {
        const questionIds = unit.checks.map((c) => c.id);
        if (new Set(questionIds).size !== questionIds.length) {
          ctx.addIssue({ code: "custom", path: ["units", index, "checks"], message: "Duplicate check id" });
        }
      }
      if (unit.transcript) {
        unit.transcript.blocks.forEach((block, blockIndex) => {
          if (block.endSeconds <= block.startSeconds) {
            ctx.addIssue({ code: "custom", path: ["units", index, "transcript", "blocks", blockIndex], message: "Transcript block end must exceed start" });
          }
        });
      }
    });
  } else {
    if (course.videoSource) {
      ctx.addIssue({ code: "custom", path: ["videoSource"], message: "Video source requires schemaVersion 7" });
    }
  if (!course.application) {
      ctx.addIssue({ code: "custom", path: ["application"], message: "Application is required" });
    }
    course.units.forEach((unit, index) => {
      if (!unit.check || unit.checks || unit.transcript) {
        ctx.addIssue({ code: "custom", path: ["units", index], message: "Legacy unit requires one check" });
      }
    });
  }

  course.units.forEach((unit, index) => {
    const checkList = unit.checks ?? (unit.check ? [unit.check] : []);
    checkList.forEach((check, checkIndex) => {
      const allValues = Object.values(check.explanations);
      const usesVerno = allValues.some((v) => v.startsWith("Верно"));
      if (!usesVerno) return;
      const vernoKeys = Object.entries(check.explanations)
        .filter(([, v]) => v.startsWith("Верно"))
        .map(([k]) => k);
      const checkPath = unit.checks
        ? ["units", index, "checks", checkIndex, "explanations"]
        : ["units", index, "check", "explanations"];
      const correctPath = unit.checks
        ? ["units", index, "checks", checkIndex, "correct"]
        : ["units", index, "check", "correct"];
      if (vernoKeys.length === 0) {
        ctx.addIssue({ code: "custom", path: checkPath, message: "No explanation starts with Верно" });
      } else if (vernoKeys.length > 1) {
        ctx.addIssue({ code: "custom", path: checkPath, message: "Multiple explanations start with Верно" });
      } else if (vernoKeys[0] !== check.correct) {
        ctx.addIssue({ code: "custom", path: correctPath, message: "Correct key does not match the Верно explanation" });
      }
    });
  });

  if (course.videoSource) {
    const chapters = course.videoSource.chapters;
    chapters.forEach((chapter, index) => {
      if (chapter.status === "ready") {
        const embeddedOnly = course.videoSource.materialMode === "embedded-only";
        if (embeddedOnly ? chapter.subtitleAsset !== undefined : !chapter.subtitleAsset) {
          ctx.addIssue({ code: "custom", path: ["videoSource", "chapters", index, "subtitleAsset"], message: "Subtitle assets must match the explicit material mode" });
        }
      }
      if (chapter.order !== index + 1) {
        ctx.addIssue({ code: "custom", path: ["videoSource", "chapters", index, "order"], message: "Chapter order must be sequential" });
      }
      if (chapter.endSeconds <= chapter.startSeconds) {
        ctx.addIssue({ code: "custom", path: ["videoSource", "chapters", index], message: "Chapter end must exceed start" });
      }
      if (chapter.endSeconds > course.videoSource.durationSeconds) {
        ctx.addIssue({ code: "custom", path: ["videoSource", "chapters", index, "endSeconds"], message: "Chapter exceeds video duration" });
      }
      if (chapter.status === "planned" && chapter.unitId !== undefined) {
        ctx.addIssue({ code: "custom", path: ["videoSource", "chapters", index, "unitId"], message: "Planned chapter cannot expose a unit" });
      }
      if (chapter.status === "ready" && chapter.unitId) {
        if (!unitIds.has(chapter.unitId)) {
          ctx.addIssue({ code: "custom", path: ["videoSource", "chapters", index, "unitId"], message: "Ready chapter references unknown unit" });
        }
      }
    });
    for (let i = 1; i < chapters.length; i++) {
      if (chapters[i].startSeconds < chapters[i - 1].endSeconds) {
        ctx.addIssue({ code: "custom", path: ["videoSource", "chapters", i], message: "Video chapters must not overlap" });
      }
    }
  }

  if (![4, 5, 6, 7, 8].includes(course.schemaVersion)) return;

  if (!Array.isArray(course.sourceArtifacts)
    || (course.schemaVersion === 4 && course.sourceArtifacts.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["sourceArtifacts"], message: "Source artifacts are required" });
    return;
  }

  if ([5, 6, 7, 8].includes(course.schemaVersion)) {
    if (!course.source.artifactAudit) {
      ctx.addIssue({
        code: "custom",
        path: ["source", "artifactAudit"],
        message: "Source artifact audit is required",
      });
    } else if (course.source.artifactAudit.artifactCount !== course.sourceArtifacts.length) {
      ctx.addIssue({
        code: "custom",
        path: ["source", "artifactAudit", "artifactCount"],
        message: "Source artifact audit count does not match",
      });
    }
  }

  const artifactIds = new Set();
  const artifactById = new Map();
  const contentTypeByKind = {
    figure: "image",
    table: "table",
    listing: "code",
    formula: "formula",
  };
  course.sourceArtifacts.forEach((artifact, index) => {
    if (artifactIds.has(artifact.id)) {
      ctx.addIssue({ code: "custom", path: ["sourceArtifacts", index, "id"], message: "Duplicate source artifact id" });
    }
    artifactIds.add(artifact.id);
    artifactById.set(artifact.id, artifact);
    const covered = artifact.coverage === "covered"
      && artifact.unitIds.length >= 1
      && artifact.exclusionReason === null;
    const excluded = artifact.coverage === "excluded"
      && artifact.unitIds.length === 0
      && artifact.exclusionReason !== null;
    if (!covered && !excluded) {
      ctx.addIssue({ code: "custom", path: ["sourceArtifacts", index], message: "Artifact coverage invariant violated" });
    }
    if ([5, 8].includes(course.schemaVersion) && artifact.coverage === "covered") {
      if (!artifact.content) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceArtifacts", index, "content"],
          message: "Renderable artifact content is required",
        });
      } else if (artifact.content.type !== "file" && contentTypeByKind[artifact.kind] !== artifact.content.type) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceArtifacts", index, "content", "type"],
          message: "Artifact kind does not match content type",
        });
      } else if (artifact.content.type === "table") {
        const columnCount = artifact.content.columns.length;
        artifact.content.rows.forEach((row, rowIndex) => {
          if (row.length !== columnCount) {
            ctx.addIssue({
              code: "custom",
              path: ["sourceArtifacts", index, "content", "rows", rowIndex],
              message: "Table rows must match column count",
            });
          }
        });
        if (artifact.content.align.length !== columnCount) {
          ctx.addIssue({
            code: "custom",
            path: ["sourceArtifacts", index, "content", "align"],
            message: "Table alignment must match column count",
          });
        }
      }
    }
    if (course.schemaVersion === 7 && artifact.coverage === "covered") {
      if (!artifact.content) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceArtifacts", index, "content"],
          message: "Renderable artifact content is required",
        });
      } else if (artifact.content.type === "youtube") {
        if (artifact.kind !== "video") {
          ctx.addIssue({ code: "custom", path: ["sourceArtifacts", index], message: "YouTube artifact kind must be video" });
        }
        if (course.videoSource && artifact.content.videoId !== course.videoSource.videoId) {
          ctx.addIssue({ code: "custom", path: ["sourceArtifacts", index, "content", "videoId"], message: "YouTube artifact videoId does not match source" });
        }
      }
    }
    if (artifact.content?.type === "file") {
      if (![6, 7, 8].includes(course.schemaVersion)) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceArtifacts", index, "content", "type"],
          message: "File content requires schemaVersion 6, 7 or 8",
        });
      }
      const validKinds = {
        image: ["figure"],
        video: ["video"],
        audio: ["audio"],
        pdf: ["document"],
        download: ["document", "attachment"],
      }[artifact.content.presentation];
      if (!validKinds.includes(artifact.kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceArtifacts", index],
          message: "Artifact kind does not match file presentation",
        });
      }
    } else if ([6, 7, 8].includes(course.schemaVersion)
      && ["video", "audio", "document", "attachment"].includes(artifact.kind)
      && artifact.content?.type !== "youtube") {
      ctx.addIssue({
        code: "custom",
        path: ["sourceArtifacts", index, "content", "type"],
        message: "SchemaVersion 6 media kinds require file content",
      });
    }
    artifact.unitIds.forEach((unitId, unitIndex) => {
      const unit = course.units.find((candidate) => candidate.id === unitId);
      if (!unit) {
        ctx.addIssue({ code: "custom", path: ["sourceArtifacts", index, "unitIds", unitIndex], message: "Unknown artifact unit" });
      } else if (!(unit.artifactRefs ?? []).includes(artifact.id)) {
        ctx.addIssue({ code: "custom", path: ["sourceArtifacts", index, "unitIds", unitIndex], message: "Artifact reference is not bidirectional" });
      }
    });
  });

  course.units.forEach((unit, index) => {
    const artifactRefs = unit.artifactRefs ?? [];
    if ([5, 8].includes(course.schemaVersion) && new Set(artifactRefs).size !== artifactRefs.length) {
      ctx.addIssue({
        code: "custom",
        path: ["units", index, "artifactRefs"],
        message: "Duplicate artifact reference",
      });
    }
    artifactRefs.forEach((artifactRef, refIndex) => {
      const artifact = artifactById.get(artifactRef);
      if (!artifact) {
        ctx.addIssue({ code: "custom", path: ["units", index, "artifactRefs", refIndex], message: "Unknown source artifact" });
      } else if (!artifact.unitIds.includes(unit.id)) {
        ctx.addIssue({ code: "custom", path: ["units", index, "artifactRefs", refIndex], message: "Artifact reference is not bidirectional" });
      }
    });
    if (course.schemaVersion === 8) {
      const blockRefs = unit.contentBlocks
        .filter((block) => block.type === "artifact")
        .map((block) => block.artifactRef);
      if (blockRefs.length !== artifactRefs.length
        || blockRefs.some((artifactRef, refIndex) => artifactRef !== artifactRefs[refIndex])) {
        ctx.addIssue({
          code: "custom",
          path: ["units", index, "contentBlocks"],
          message: "SchemaVersion 8 artifact blocks must match artifactRefs in order",
        });
      }
    }
  });
});
