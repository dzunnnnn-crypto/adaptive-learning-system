import { z } from "zod";

const DetailSchema = z.object({
  kind: z.literal("detail"),
  explanation: z.string().min(20),
  example: z.string().min(10),
  caveat: z.string().min(10),
});

const RephraseSchema = z.object({
  kind: z.literal("rephrase"),
  explanation: z.string().min(20),
  analogy: z.string().min(10),
  suggestSmaller: z.literal(true),
});

const PracticeSchema = z.object({
  kind: z.literal("practice"),
  task: z.string().min(20),
  expectedMinutes: z.number().int().min(3).max(5),
  evaluationGuide: z.string().min(10),
});

const PracticeReviewSchema = z.object({
  kind: z.literal("practice-review"),
  correct: z.boolean(),
  feedback: z.string().min(20),
  nextHint: z.string().min(5),
});

const ClarificationSchema = z.object({
  kind: z.literal("clarification"),
  answer: z.string().min(10),
  basis: z.enum(["course", "general", "mixed"]),
});

export const AiResponseSchema = z.discriminatedUnion("kind", [
  DetailSchema,
  RephraseSchema,
  PracticeSchema,
  PracticeReviewSchema,
  ClarificationSchema,
]);
