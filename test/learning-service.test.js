import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningService } from "../src/application/learning-service.js";
import { buildPrompt } from "../src/ai/prompt-builder.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";
import { API_VERSION } from "../src/app-identity.js";

const course = makeUniversalCourse({ withActivity: true });
const fixedClock = () => new Date("2026-07-19T20:00:00.000Z");
const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeHarness({ activeCourse = course, state, provider } = {}) {
  let current = structuredClone(state ?? createInitialState(activeCourse));
  const store = {
    load: vi.fn(async () => structuredClone(current)),
    save: vi.fn(async (next) => {
      current = structuredClone(next);
    }),
  };
  const effectiveProvider = provider ?? { generate: vi.fn() };
  const service = new LearningService({
    course: activeCourse,
    store,
    provider: effectiveProvider,
    promptBuilder: buildPrompt,
    clock: fixedClock,
  });
  return { service, store, provider: effectiveProvider };
}

async function makeFileHarness(state, provider) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "learning-service-"));
  tempDirs.push(dir);
  const file = path.join(dir, "learning_memory.md");
  await fs.copyFile("test/fixtures/learning-memory.md", file);
  const store = new LearningMemoryStore(file);
  if (state) await store.save(state);
  const service = new LearningService({
    course,
    store,
    provider,
    promptBuilder: buildPrompt,
    clock: fixedClock,
  });
  return { file, service, store };
}

function blockState({ cursor = 0, targetSize = 1, status = "awaiting-answer" } = {}) {
  return {
    ...createInitialState(course, { cursor, targetSize }),
    activeUnitIds: course.units.slice(cursor, cursor + targetSize).map((unit) => unit.id),
    activeQuestionUnitId: course.units.at(cursor + targetSize - 1)?.id ?? null,
    status,
  };
}

describe("LearningService", () => {
  it("persists block sizes above five across service loads", async () => {
    const { service } = makeHarness({ state: blockState({ targetSize: 5 }) });

    expect((await service.resize(1)).actualSize).toBe(6);
    expect((await service.resize(1)).actualSize).toBe(7);
  });

  it("persists a local answer review", async () => {
    const { service, store } = makeHarness();
    const view = await service.answer("А");
    expect(view).toMatchObject({ status: "reviewed", lifecycleStatus: "in-progress" });
    expect(store.save).toHaveBeenCalledOnce();
  });

  it("exposes and persists an optional prepared activity", async () => {
    const { service, store } = makeHarness();
    const initial = await service.getView();

    expect(initial.activities).toMatchObject([{
      unitId: "foundation-goal",
      completed: false,
    }]);

    const completed = await service.completeActivity(
      "foundation-goal",
      "Команда выполнена, ожидаемый ответ получен.",
    );

    expect(completed.activities).toMatchObject([{
      unitId: "foundation-goal",
      completed: true,
      result: "Команда выполнена, ожидаемый ответ получен.",
    }]);
    expect((await store.load()).activityHistory).toHaveLength(1);
  });

  it("does not persist when AI generation fails", async () => {
    const provider = { generate: vi.fn().mockRejectedValue(new Error("quota")) };
    const { service, store } = makeHarness({ provider });
    await expect(service.generateLayer("detail")).rejects.toThrow();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("stores a successful practice review in history", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          kind: "practice",
          task: "Проверь постановку задачи для бота.",
          expectedMinutes: 3,
          evaluationGuide: "Есть цель и критерий готовности.",
        })
        .mockResolvedValueOnce({
          kind: "practice-review",
          correct: true,
          feedback: "Задача сформулирована достаточно ясно.",
          nextHint: "Примени это к живой задаче.",
        }),
    };
    const { service } = makeHarness({ provider });
    await service.startPractice();
    const view = await service.reviewPractice("Мой ответ");
    expect(view.practiceHistory).toHaveLength(1);
  });

  it("persists the actual profile on every generated learning artifact", async () => {
    const generatedBy = { profileId: "zai-glm-5-2-max", label: "GLM · 5.2 · Max" };
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          kind: "detail",
          explanation: "Дополнительное объяснение текущего учебного материала.",
          example: "Конкретный пример для практического применения.",
          caveat: "Проверяй результат в живой задаче.",
          generatedBy,
        })
        .mockResolvedValueOnce({
          kind: "practice",
          task: "Сформулируй короткую проверяемую задачу по этому фрагменту.",
          expectedMinutes: 3,
          evaluationGuide: "Есть действие и наблюдаемый результат.",
          generatedBy,
        })
        .mockResolvedValueOnce({
          kind: "practice-review",
          correct: true,
          feedback: "Ответ содержит проверяемое действие и критерий готовности.",
          nextHint: "Выполни это на следующей живой задаче.",
          generatedBy,
        })
        .mockResolvedValueOnce({
          kind: "clarification",
          answer: "Профиль остаётся подписью каждого сохранённого ответа.",
          basis: "course",
          generatedBy,
        }),
    };
    const { service, store } = makeHarness({ provider });

    const layered = await service.generateLayer("detail");
    await service.startPractice();
    const reviewed = await service.reviewPractice("Мой вариант");
    const clarified = await service.askClarification("Кем создан ответ?");

    expect(layered.layers.at(-1).generatedBy).toEqual(generatedBy);
    expect(reviewed.practiceHistory.at(-1).practice.generatedBy).toEqual(generatedBy);
    expect(reviewed.practiceHistory.at(-1).review.generatedBy).toEqual(generatedBy);
    expect(clarified.clarificationThread.messages.at(-1).generatedBy).toEqual(generatedBy);
    expect((await store.load()).clarificationThread.messages.at(-1).generatedBy).toEqual(generatedBy);
  });

  it("records the chosen live application", async () => {
    const applicationState = {
      ...createInitialState(course, { cursor: course.units.length }),
      activeUnitIds: [],
      activeQuestionUnitId: null,
      status: "awaiting-application",
    };
    const { service, store } = makeHarness({ state: applicationState });
    const view = await service.chooseApplication("В");
    expect(view).toMatchObject({ status: "complete", applicationChoice: "В" });
    expect(store.save).toHaveBeenCalledOnce();
  });

  it("keeps the core lesson and local answer available when AI is offline", async () => {
    const provider = { generate: vi.fn().mockRejectedValue(new Error("offline")) };
    const { service } = makeHarness({ provider });
    expect((await service.getView()).units.map((unit) => unit.id)).toEqual(["foundation-goal"]);
    const reviewed = await service.answer("А");
    expect(reviewed).toMatchObject({ status: "reviewed", canGoNext: true });
  });

  it("leaves the machine block byte-for-byte unchanged after AI failure", async () => {
    const provider = { generate: vi.fn().mockRejectedValue(new Error("timeout")) };
    const { file, service } = await makeFileHarness(blockState({ cursor: 2 }), provider);
    const before = await fs.readFile(file, "utf8");
    await expect(service.generateLayer("detail")).rejects.toThrow("timeout");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("reloads an unfinished block with the two prior answers", async () => {
    const checkpoint = {
      ...blockState({ cursor: 2 }),
      answerHistory: [
        { unitId: "foundation-goal", choice: "А", correct: true, explanation: "Первый ответ." },
        { unitId: "foundation-context", choice: "Б", correct: true, explanation: "Второй ответ." },
      ],
      askedQuestionIds: ["foundation-goal", "foundation-context"],
      completedUnitIds: ["foundation-goal", "foundation-context"],
    };
    const { service } = await makeFileHarness(checkpoint, { generate: vi.fn() });
    const view = await service.getView();
    expect(view.units.map((unit) => unit.id)).toEqual(["foundation-constraints"]);
    expect(view.status).toBe("awaiting-answer");
    expect(view.answerHistory.map(({ choice }) => choice)).toEqual(["А", "Б"]);
  });

  it("persists a two-fragment target from the active fragment", async () => {
    const { service, store } = makeHarness();
    const resized = await service.resize(1);
    expect(resized.units.map((unit) => unit.id))
      .toEqual(["foundation-goal", "foundation-context"]);
    expect((await store.load()).targetSize).toBe(2);
  });

  it("returns versioned metadata, size flags, and section groups", async () => {
    const { service } = makeHarness({
      state: createInitialState(course, { cursor: 2, targetSize: 3 }),
    });
    const view = await service.getView();
    expect(view).toMatchObject({
      appId: "adaptive-codex-learning",
      apiVersion: API_VERSION,
      courseId: "sample-article",
      contentVersion: 1,
    });
    expect(view.actualSize).toBe(3);
    expect(view.canIncrease).toBe(true);
    expect(view.canDecrease).toBe(true);
    expect(view.sectionGroups.map((group) => group.id)).toEqual(["foundation", "practice"]);
    expect(view.question).toEqual(course.units[2].check);
    expect(view).toMatchObject({ questionPosition: 1, questionCount: 3 });
  });

  it("keeps every question after a multi-fragment reading block", async () => {
    const { service } = makeHarness({
      state: createInitialState(course, { targetSize: 3 }),
    });

    const firstReview = await service.answer("А");
    expect(firstReview).toMatchObject({ nextAction: "question", remainingQuestionCount: 2 });

    const secondQuestion = await service.next();
    expect(secondQuestion).toMatchObject({
      status: "awaiting-answer",
      question: course.units[1].check,
      questionPosition: 2,
      questionCount: 3,
    });
    expect((await service.getView()).question).toEqual(course.units[1].check);

    await service.answer("Б");
    const thirdQuestion = await service.next();
    expect(thirdQuestion.question).toEqual(course.units[2].check);
    await service.answer("В");
    const nextBlock = await service.next();
    expect(nextBlock).toMatchObject({ cursor: 3, question: course.units[3].check });
  });

  it("returns only renderable artifacts referenced by the active units", async () => {
    const activeCourse = makeUniversalCourse({ withRenderableArtifacts: true });
    const { service } = makeHarness({ activeCourse });

    const view = await service.getView();
    expect(view.sourceArtifacts.map(({ id }) => id))
      .toEqual(["figure-foundation-map"]);

    const resized = await service.resize(1);
    expect(resized.sourceArtifacts.map(({ id }) => id)).toEqual([
      "figure-foundation-map",
      "table-foundation-summary",
    ]);
  });

  it("deduplicates a renderable artifact referenced by two active units", async () => {
    const activeCourse = makeUniversalCourse({ withRenderableArtifacts: true });
    activeCourse.units[1].artifactRefs.unshift("figure-foundation-map");
    activeCourse.sourceArtifacts[0].unitIds.push("foundation-context");
    const { service } = makeHarness({ activeCourse });

    const view = await service.resize(1);
    expect(view.sourceArtifacts.map(({ id }) => id)).toEqual([
      "figure-foundation-map",
      "table-foundation-summary",
    ]);
  });

  it("does not expose metadata-only schemaVersion 4 artifacts", async () => {
    const activeCourse = makeUniversalCourse({ schemaVersion: 4, withArtifacts: true });
    activeCourse.sourceArtifacts[0].content = {
      type: "table",
      columns: ["Тема", "Смысл"],
      rows: [["Контекст", "Метаданные v4 не отображаются"]],
      align: ["left", "left"],
    };
    const { service } = makeHarness({ activeCourse });

    expect((await service.getView()).sourceArtifacts).toEqual([]);
  });

  it("returns a progress summary without persisting initialized state", async () => {
    const { service, store } = makeHarness();

    expect(await service.getSummary()).toMatchObject({
      lifecycleStatus: "new",
      completedUnits: 0,
      totalUnits: 7,
      progress: 0,
      currentTitle: "Фрагмент 1",
    });
    expect(store.save).not.toHaveBeenCalled();
  });

  it("returns outline and completed review without saving state", async () => {
    const activeCourse = makeUniversalCourse({ withRenderableArtifacts: true });
    const state = {
      ...createInitialState(activeCourse, { cursor: 1 }),
      completedUnitIds: ["foundation-goal"],
      activeUnitIds: ["foundation-context"],
      activeQuestionUnitId: "foundation-context",
    };
    const { service, store } = makeHarness({ activeCourse, state });

    expect((await service.getOutline()).sections[0].units.map(({ status }) => status))
      .toEqual(["completed", "current", "locked"]);
    expect((await service.getReview("foundation-goal")).unit.id)
      .toBe("foundation-goal");
    expect(store.save).not.toHaveBeenCalled();
  });

  it("does not change a reviewed block through the service", async () => {
    const { service, store } = makeHarness({ state: blockState({ status: "reviewed" }) });
    await expect(service.resize(1)).rejects.toThrow();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("persists one clarification exchange with the active context", async () => {
    const provider = { generate: vi.fn().mockResolvedValue({
      kind: "clarification",
      answer: "Контекст объясняет, что именно нужно учитывать.",
      basis: "course",
    }) };
    const { service, store } = makeHarness({ provider });
    const view = await service.askClarification("Зачем нужен контекст?");
    expect(provider.generate).toHaveBeenCalledWith(
      expect.stringContaining("Зачем нужен контекст?"),
      "clarification",
    );
    expect(view.clarificationThread.messages).toHaveLength(2);
    expect((await store.load()).clarificationThread.messages[1])
      .toMatchObject({ role: "assistant", basis: "course", activeUnitIds: ["foundation-goal"] });
  });

  it("does not persist a clarification question when Codex fails", async () => {
    const provider = { generate: vi.fn().mockRejectedValue(new Error("timeout")) };
    const { service, store } = makeHarness({ provider });
    await expect(service.askClarification("Почему?")).rejects.toThrow("timeout");
    expect(store.save).not.toHaveBeenCalled();
  });

  it("marks a context change after resizing a non-empty clarification thread", async () => {
    const provider = { generate: vi.fn().mockResolvedValue({
      kind: "clarification", answer: "Достаточно длинный ответ модели.", basis: "general",
    }) };
    const { service } = makeHarness({ provider });
    await service.askClarification("Первый вопрос");
    const view = await service.resize(1);
    expect(view.clarificationThread.messages.at(-1)).toMatchObject({
      role: "context-change",
      fromUnitIds: ["foundation-goal"],
      toUnitIds: ["foundation-goal", "foundation-context"],
    });
  });

  it("archives clarification messages when advancing", async () => {
    const state = {
      ...blockState({ status: "reviewed" }),
      clarificationThread: {
        courseId: "sample-article",
        cursor: 0,
        messages: [{ role: "user", text: "Вопрос", activeUnitIds: ["foundation-goal"], createdAt: fixedClock().toISOString() }],
      },
    };
    const { service, store } = makeHarness({ state });
    const view = await service.next();
    expect(view.clarificationThread.messages).toEqual([]);
    expect(view).not.toHaveProperty("clarificationHistory");
    expect((await store.load()).clarificationHistory).toHaveLength(1);
  });

  it("serializes clarification and resize without losing either result", async () => {
    let resolveProvider;
    const pending = new Promise((resolve) => { resolveProvider = resolve; });
    const provider = { generate: vi.fn(() => pending) };
    const { service, store } = makeHarness({ provider });

    const clarification = service.askClarification("Первый вопрос");
    await vi.waitFor(() => expect(provider.generate).toHaveBeenCalledOnce());
    const resize = service.resize(1);
    expect(store.save).not.toHaveBeenCalled();

    resolveProvider({
      kind: "clarification",
      answer: "Достаточно длинный ответ модели.",
      basis: "course",
    });
    await clarification;
    const resized = await resize;
    expect(resized.activeUnitIds).toEqual(["foundation-goal", "foundation-context"]);
    expect(resized.clarificationThread.messages.map(({ role }) => role))
      .toEqual(["user", "assistant", "context-change"]);
  });

  it("opens the prepared application after the final fragment and completes on selection", async () => {
    const lastBlock = {
      ...blockState({ cursor: course.units.length - 1 }),
      completedUnitIds: course.units.slice(0, -1).map((unit) => unit.id),
    };
    const { service } = makeHarness({ state: lastBlock });
    await service.answer("А");
    const application = await service.next();
    expect(application).toMatchObject({ status: "awaiting-application" });
    expect(Object.keys(application.application.choices)).toEqual(["А", "Б", "В"]);
    const complete = await service.chooseApplication("В");
    expect(complete).toMatchObject({ status: "complete", applicationChoice: "В" });
  });
});
