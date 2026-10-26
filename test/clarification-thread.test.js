import { describe, expect, it } from "vitest";
import {
  appendContextChange,
  appendExchange,
  archiveAndResetClarification,
  compactContextChanges,
  createClarificationThread,
} from "../src/domain/clarification-thread.js";

const at = "2026-07-19T20:00:00.000Z";

describe("clarification thread", () => {
  it("appends a complete question and answer pair", () => {
    const thread = createClarificationThread("best-practices", 2);
    const next = appendExchange(thread, {
      question: "Почему правило должно быть конкретным?",
      result: { kind: "clarification", answer: "Так его можно проверить.", basis: "course" },
      unitIds: ["bp-03"],
      createdAt: at,
    });
    expect(next.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(next.messages[1]).toMatchObject({ basis: "course", activeUnitIds: ["bp-03"] });
  });

  it("preserves trusted profile attribution on a new assistant message", () => {
    const generatedBy = { profileId: "codex-sol-xhigh", label: "Codex · Sol · Very High" };
    const next = appendExchange(createClarificationThread("best-practices", 2), {
      question: "Какой профиль ответил?",
      result: {
        kind: "clarification",
        answer: "Ответ создан выбранным профилем.",
        basis: "course",
        generatedBy,
      },
      unitIds: ["bp-03"],
      createdAt: at,
    });
    generatedBy.label = "Подменённая подпись";

    expect(next.messages.at(-1)).toMatchObject({
      generatedBy: { profileId: "codex-sol-xhigh", label: "Codex · Sol · Very High" },
    });
  });

  it("adds a context marker only to a non-empty thread", () => {
    const empty = createClarificationThread("best-practices", 2);
    expect(appendContextChange(empty, {
      fromUnitIds: ["bp-03"], toUnitIds: ["bp-03", "bp-04"], createdAt: at,
    })).toEqual(empty);

    const populated = appendExchange(empty, {
      question: "Вопрос",
      result: { kind: "clarification", answer: "Достаточно длинный ответ.", basis: "general" },
      unitIds: ["bp-03"],
      createdAt: at,
    });
    expect(appendContextChange(populated, {
      fromUnitIds: ["bp-03"], toUnitIds: ["bp-03", "bp-04"], createdAt: at,
    }).messages.at(-1).role).toBe("context-change");
  });

  it("collapses consecutive context changes into one final transition", () => {
    const populated = appendExchange(createClarificationThread("best-practices", 2), {
      question: "Вопрос",
      result: { kind: "clarification", answer: "Ответ.", basis: "course" },
      unitIds: ["bp-03"],
      createdAt: at,
    });
    const compacted = compactContextChanges({
      ...populated,
      messages: [
        ...populated.messages,
        { role: "context-change", fromUnitIds: ["bp-03"], toUnitIds: ["bp-03", "bp-04"], createdAt: "2026-07-19T20:01:00.000Z" },
        { role: "context-change", fromUnitIds: ["bp-03", "bp-04"], toUnitIds: ["bp-03", "bp-04", "bp-05"], createdAt: "2026-07-19T20:02:00.000Z" },
        { role: "context-change", fromUnitIds: ["bp-03", "bp-04", "bp-05"], toUnitIds: ["bp-03", "bp-04"], createdAt: "2026-07-19T20:03:00.000Z" },
      ],
    });

    expect(compacted.messages.map(({ role }) => role))
      .toEqual(["user", "assistant", "context-change"]);
    expect(compacted.messages.at(-1)).toEqual({
      role: "context-change",
      fromUnitIds: ["bp-03"],
      toUnitIds: ["bp-03", "bp-04"],
      createdAt: "2026-07-19T20:03:00.000Z",
    });
  });

  it("removes a context-change run that returns to its original composition", () => {
    const compacted = compactContextChanges({
      courseId: "best-practices",
      cursor: 2,
      messages: [
        { role: "user", text: "Вопрос" },
        { role: "assistant", text: "Ответ." },
        { role: "context-change", fromUnitIds: ["bp-03"], toUnitIds: ["bp-03", "bp-04"], createdAt: at },
        { role: "context-change", fromUnitIds: ["bp-03", "bp-04"], toUnitIds: ["bp-03"], createdAt: at },
      ],
    });

    expect(compacted.messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
  });

  it("keeps context markers separated by a real conversation message", () => {
    const compacted = compactContextChanges({
      courseId: "best-practices",
      cursor: 2,
      messages: [
        { role: "context-change", fromUnitIds: ["bp-03"], toUnitIds: ["bp-03", "bp-04"], createdAt: at },
        { role: "user", text: "Новый вопрос" },
        { role: "context-change", fromUnitIds: ["bp-03", "bp-04"], toUnitIds: ["bp-03", "bp-04", "bp-05"], createdAt: at },
      ],
    });

    expect(compacted.messages.filter(({ role }) => role === "context-change"))
      .toHaveLength(2);
  });

  it("archives a non-empty thread and resets the next block", () => {
    const state = {
      courseId: "best-practices",
      clarificationThread: appendExchange(createClarificationThread("best-practices", 2), {
        question: "Вопрос",
        result: { kind: "clarification", answer: "Достаточно длинный ответ.", basis: "mixed" },
        unitIds: ["bp-03"],
        createdAt: at,
      }),
      clarificationHistory: [],
    };
    const next = archiveAndResetClarification(state, {
      finalUnitIds: ["bp-03"], nextCursor: 3, completedAt: at,
    });
    expect(next.clarificationHistory).toHaveLength(1);
    expect(next.clarificationThread).toMatchObject({ cursor: 3, messages: [] });
  });
});
