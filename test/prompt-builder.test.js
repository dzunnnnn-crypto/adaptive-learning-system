import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/ai/prompt-builder.js";

const units = [{ id: "bp-03", title: "AGENTS.md", coreText: "Постоянные правила проекта." }];

describe("buildPrompt", () => {
  it("keeps course material primary and allows live web search", () => {
    const prompt = buildPrompt({ operation: "detail", units });
    expect(prompt).toContain("Живой веб-поиск разрешён");
    expect(prompt).toContain("Сам решай, нужен ли");
    expect(prompt).toContain("названия источников и прямые URL");
    expect(prompt).not.toContain("Не добавляй новые факты");
    expect(prompt).toContain("Постоянные правила проекта");
    expect(prompt).toContain('"kind":"detail"');
  });

  it("requires a different explanation for rephrase", () => {
    const prompt = buildPrompt({ operation: "rephrase", units });
    expect(prompt).toContain("не повторяй исходную формулировку");
    expect(prompt).toContain('"suggestSmaller":true');
  });

  it("uses semantic content blocks as the AI source material", () => {
    const prompt = buildPrompt({
      operation: "detail",
      units: [{
        id: "formatted-unit",
        title: "Форматированный фрагмент",
        contentBlocks: [
          { type: "heading", level: 2, runs: [{ type: "text", text: "Подзаголовок" }] },
          { type: "paragraph", runs: [{ type: "strong", text: "Главная мысль." }] },
          {
            type: "list",
            ordered: true,
            items: [[{ type: "text", text: "Первый шаг" }]],
          },
        ],
      }],
    });

    expect(prompt).toContain("Подзаголовок");
    expect(prompt).toContain("Главная мысль.");
    expect(prompt).toContain("1. Первый шаг");
  });

  it("includes the active task and its guide when reviewing practice", () => {
    const prompt = buildPrompt({
      operation: "practice-review",
      units,
      userAnswer: "Мой вариант правила",
      practice: { task: "Сформулируй правило", evaluationGuide: "Есть запрет и проверка" },
    });
    expect(prompt).toContain("Сформулируй правило");
    expect(prompt).toContain("Есть запрет и проверка");
    expect(prompt).toContain("Мой вариант правила");
  });

  it("builds a clarification prompt with history and general-knowledge rules", () => {
    const prompt = buildPrompt({
      operation: "clarification",
      units,
      clarificationQuestion: "А если правило относится только к одному проекту?",
      clarificationMessages: [
        { role: "user", text: "Что хранить в AGENTS.md?" },
        { role: "assistant", text: "Повторяемые правила.", basis: "course" },
      ],
    });
    expect(prompt).toContain("А если правило относится только к одному проекту?");
    expect(prompt).toContain("Что хранить в AGENTS.md?");
    expect(prompt).toContain("можешь использовать общие знания модели");
    expect(prompt).toContain("Для актуальных или изменяемых сведений обязательно используй живой веб-поиск");
    expect(prompt).toContain("названия источников и прямые URL");
    expect(prompt).toContain("Не используй файловые или командные инструменты");
    expect(prompt).not.toContain("не используй файлы, инструменты, сеть или веб-поиск");
    expect(prompt).not.toContain("актуальность не проверялась");
    expect(prompt).toContain('"kind":"clarification"');
  });
});
