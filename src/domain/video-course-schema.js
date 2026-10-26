import { z } from "zod";

const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const VideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const RussianLetterObject = z.object({
  "А": z.string().min(1),
  "Б": z.string().min(1),
  "В": z.string().min(1),
}).strict();

export const VideoCheckSchema = z.object({
  id: IdentifierSchema,
  prompt: z.string().min(10),
  choices: RussianLetterObject,
  correct: z.enum(["А", "Б", "В"]),
  explanations: RussianLetterObject,
}).strict();

export const TranscriptSchema = z.object({
  language: z.literal("ru"),
  kind: z.literal("cleaned"),
  blocks: z.array(z.object({
    id: IdentifierSchema,
    startSeconds: z.number().int().nonnegative(),
    endSeconds: z.number().int().positive(),
    text: z.string().trim().min(20).max(5000),
  }).strict()).min(1),
}).strict();

const SubtitleAssetSchema = z.object({
  fileName: z.string().regex(/^[a-z0-9][a-z0-9._-]*\.vtt$/),
  mimeType: z.literal("text/vtt"),
  sizeBytes: z.number().int().positive(),
  sha256: HashSchema,
  language: z.literal("ru"),
  extractorVersion: z.string().min(1).max(80),
}).strict();

const ChapterBase = {
  id: IdentifierSchema,
  order: z.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  startSeconds: z.number().int().nonnegative(),
  endSeconds: z.number().int().positive(),
};

export const VideoChapterSchema = z.discriminatedUnion("status", [
  z.object({
    ...ChapterBase,
    status: z.literal("ready"),
    unitId: IdentifierSchema,
    subtitleAsset: SubtitleAssetSchema.optional(),
  }).strict(),
  z.object({
    ...ChapterBase,
    status: z.literal("planned"),
    unitId: IdentifierSchema.optional(),
  }).strict(),
]);

export const VideoSourceSchema = z.object({
  platform: z.literal("youtube"),
  videoId: VideoIdSchema,
  canonicalUrl: z.string().url(),
  channel: z.string().trim().min(1).max(200),
  materialMode: z.enum(["transcript", "embedded-only"]).optional(),
  durationSeconds: z.number().int().positive(),
  chapters: z.array(VideoChapterSchema).min(1),
}).strict();

export const YouTubeContentSchema = z.object({
  type: z.literal("youtube"),
  videoId: VideoIdSchema,
  startSeconds: z.number().int().nonnegative(),
  endSeconds: z.number().int().positive(),
  accessibilityText: z.string().trim().min(3).max(500),
}).strict();
