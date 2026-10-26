import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrap, render, wireActions } from "../public/app.js";
import { courseIdFromPath, coursePath, renderCatalog, toggleCourseSort } from "../public/course-library.js";
import { initThemeControl } from "../public/theme.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

const baseView = {
  courseId: "best-practices",
  title: "Best practices for Codex",
  progress: 0.4,
  cursor: 2,
  units: [{
    id: "bp-03",
    title: "Что переносить в AGENTS.md",
    coreText: "Постоянные правила проекта.",
  }],
  actualSize: 1,
  canIncrease: true,
  canDecrease: false,
  sizeLimitReason: null,
  sectionGroups: [{
    id: "durable-workflow",
    title: "Постоянные правила и среда",
    units: [{
      id: "bp-03",
      title: "Что переносить в AGENTS.md",
      coreText: "Постоянные правила проекта.",
    }],
  }],
  question: {
    prompt: "Какое правило сохранить?",
    choices: { "А": "Конкретное", "Б": "Историю", "В": "Общее пожелание" },
  },
  status: "awaiting-answer",
  answer: null,
  canGoNext: false,
  layers: [],
  practice: null,
  practiceHistory: [],
  application: null,
  activities: [],
  clarificationThread: { courseId: "best-practices", cursor: 2, messages: [] },
};

const aiProfiles = {
  selectedProfileId: "codex-terra-medium",
  profiles: [
    { id: "codex-terra-medium", label: "Codex · Terra · Medium", provider: "codex", available: true, unavailableReason: null },
    { id: "codex-sol-xhigh", label: "Codex · Sol · Very High", provider: "codex", available: true, unavailableReason: null },
    { id: "zai-glm-5-2-max", label: "GLM · 5.2 · Max", provider: "zai", available: false, unavailableReason: "Добавь ZAI_API_KEY в .env.local" },
    { id: "zai-glm-5-turbo", label: "GLM · 5-Turbo", provider: "zai", available: false, unavailableReason: "Добавь ZAI_API_KEY в .env.local" },
  ],
};

const outlinePayload = {
  appId: "adaptive-codex-learning",
  apiVersion: 10,
  courseId: "js-fetch",
  title: "JS Fetch",
  progress: { completed: 1, total: 3 },
  sections: [{
    id: "requests",
    title: "Запросы",
    order: 1,
    progress: { completed: 1, total: 3 },
    containsCurrent: true,
    units: [
      { id: "request-done", title: "Пройденный запрос", order: 1, status: "completed" },
      { id: "request-current", title: "Текущий запрос", order: 2, status: "current" },
      { id: "request-future", title: "Будущий запрос", order: 3, status: "locked" },
    ],
  }],
};

const reviewPayload = {
  appId: "adaptive-codex-learning",
  apiVersion: 10,
  courseId: "js-fetch",
  courseTitle: "JS Fetch",
  section: { id: "requests", title: "Запросы" },
  unit: {
    id: "request-done",
    title: "Пройденный запрос",
    coreText: "Сохранённый материал одного фрагмента.",
  },
  sourceArtifacts: [],
};

let document;

beforeEach(async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  document = new JSDOM(html, { url: "http://127.0.0.1:4173" }).window.document;
});

function response(body, ok = true) {
  return { ok, json: async () => body };
}

describe("focus-first browser UI", () => {
  it("renders compact course rows with the last course as Continue", () => {
    renderCatalog({
      lastCourseId: "js-fetch",
      courses: [
        { id: "build-skills", title: "Build skills", summary: "Навыки Codex из официальной статьи.", availability: "available", lifecycleStatus: "in-progress", completedUnits: 0, totalUnits: 20, progress: 0, currentTitle: "Первый навык" },
        { id: "js-fetch", title: "JS Fetch", summary: "Практические запросы к внешнему API.", availability: "available", lifecycleStatus: "in-progress", completedUnits: 17, totalUnits: 50, progress: 0.34, currentTitle: "response.ok" },
        { id: "best-practices", title: "Best practices for Codex", summary: "Завершённая статья о работе с Codex.", availability: "available", lifecycleStatus: "complete", completedUnits: 19, totalUnits: 19, progress: 1, currentTitle: null },
      ],
    }, document);

    expect(document.querySelectorAll("[data-action=open-course], [data-action=continue-course]")).toHaveLength(2);
    expect(document.querySelector("[data-action=continue-course]").dataset.courseId).toBe("js-fetch");
    expect(document.body.textContent).toContain("17 из 50");
    const completedGrid = document.querySelector("[data-role=completed-grid]");
    expect(completedGrid.textContent).toContain("Best practices for Codex");
    expect(completedGrid.textContent).toContain("пройден");
    expect(completedGrid.hidden).toBe(true);
    expect(document.querySelector("[data-action=toggle-completed]").textContent).toContain("Пройденные · 1 курсов");
    expect(document.querySelectorAll("[data-action=toggle-inline-outline]")).toHaveLength(2);
  });

  it("renders a collection as one collapsed course and keeps the archive compact", () => {
    renderCatalog({
      lastCourseId: "chapter-one",
      courses: [
        {
          id: "chapter-one",
          title: "Первая глава",
          availability: "available",
          lifecycleStatus: "in-progress",
          completedUnits: 2,
          totalUnits: 6,
          progress: 1 / 3,
          currentTitle: "Первый фрагмент",
          source: { author: "Автор", kind: "PDF", url: "/source" },
          collection: { id: "book", title: "Книга", itemTitle: "Глава 1. Первая глава", order: 1 },
        },
        {
          id: "chapter-two",
          title: "Вторая глава",
          availability: "available",
          lifecycleStatus: "new",
          completedUnits: 0,
          totalUnits: 5,
          progress: 0,
          currentTitle: "Начало",
          source: { author: "Автор", kind: "PDF", url: "/source" },
          collection: { id: "book", title: "Книга", itemTitle: "Глава 2. Вторая глава", order: 2 },
        },
        {
          id: "archived-course",
          title: "Архивный курс",
          archived: true,
          availability: "available",
          lifecycleStatus: "complete",
          completedUnits: 3,
          totalUnits: 3,
          progress: 1,
          currentTitle: null,
        },
      ],
    }, document);

    const collection = document.querySelector(".course-collection");
    expect(collection).not.toBeNull();
    expect(collection.querySelectorAll("[data-course-card]")).toHaveLength(0);
    expect(collection.querySelector("[data-collection-outline]").hidden).toBe(true);
    expect(collection.textContent).toContain("2 из 11");
    expect(collection.querySelector(".course-state").textContent).toContain("Главы · 2");

    const completedGrid = document.querySelector("[data-role=completed-grid]");
    expect(completedGrid.textContent).toContain("Архивный курс");
    expect(completedGrid.hidden).toBe(true);
    expect(completedGrid.querySelector("[data-action=restore-course]")).not.toBeNull();
    expect(document.querySelector("[data-action=toggle-completed]").textContent).toContain("Пройденные · 1 курсов");

    const archive = document.querySelector("[data-role=archived-grid]");
    expect(archive.hidden).toBe(true);
    expect(archive.textContent).not.toContain("Архивный курс");
    expect(document.querySelector("[data-action=toggle-archive]").textContent).toContain("Архив · 0 курсов");
  });

  it("reverses the order when the same sort mode is picked again", () => {
    localStorage.removeItem("courseSortMode");
    localStorage.removeItem("courseSortDir");
    const sortCourses = [
      { id: "course-old", order: 1, title: "Старый курс", summary: "Добавлен раньше остальных.", availability: "available", lifecycleStatus: "new", completedUnits: 0, totalUnits: 5, progress: 0, currentTitle: null, addedAt: "2026-08-01", updatedAt: "2026-08-01T10:00:00.000Z" },
      { id: "course-new", order: 2, title: "Свежий курс", summary: "Добавлен позже остальных.", availability: "available", lifecycleStatus: "new", completedUnits: 2, totalUnits: 5, progress: 0.4, currentTitle: null, addedAt: "2026-09-20", updatedAt: "2026-09-20T10:00:00.000Z" },
    ];
    const payload = () => ({ lastCourseId: null, courses: sortCourses.map((course) => ({ ...course })) });
    renderCatalog(payload(), document);
    const firstTitle = () => document.querySelector("[data-role=course-grid] .course-row-title-line h3").textContent;
    expect(firstTitle()).toBe("Свежий курс");
    expect(document.querySelector("[data-action=sort-courses].is-active").textContent).toContain("↓");

    toggleCourseSort("added");
    renderCatalog(payload(), document);
    expect(firstTitle()).toBe("Старый курс");
    expect(document.querySelector("[data-action=sort-courses].is-active").textContent).toContain("↑");

    toggleCourseSort("added");
    renderCatalog(payload(), document);
    expect(firstTitle()).toBe("Свежий курс");
    expect(document.querySelector("[data-action=sort-courses].is-active").textContent).toContain("↓");

    toggleCourseSort("used");
    renderCatalog(payload(), document);
    expect(document.querySelector("[data-action=sort-courses].is-active").dataset.sort).toBe("used");
    expect(firstTitle()).toBe("Свежий курс");
  });

  it("opens inline course content without selecting or navigating to the course", async () => {
    const root = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/",
    }).window.document;
    const catalog = {
      lastCourseId: null,
      courses: [{
        id: "js-fetch",
        title: "JS Fetch",
        summary: "Практические запросы.",
        availability: "available",
        lifecycleStatus: "in-progress",
        completedUnits: 1,
        totalUnits: 3,
        progress: 1 / 3,
        currentTitle: "Текущий запрос",
      }],
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response(catalog))
      .mockResolvedValueOnce(response(outlinePayload));

    await bootstrap({ root, fetchImpl });
    root.querySelector("[data-action=toggle-inline-outline]").click();

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "/api/ai/profiles",
      "/api/courses",
      "/api/courses/js-fetch/outline",
    ]);
    expect(root.defaultView.location.pathname).toBe("/");
    expect(root.body.dataset.activeCourseId).toBeUndefined();
    expect(root.querySelector("[data-inline-outline]").hidden).toBe(false);
    expect(root.querySelector("[data-role=course-outline]").hidden).toBe(true);
  });

  it("opens the same outline from the lesson header", async () => {
    const root = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/course/js-fetch",
    }).window.document;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ ...baseView, courseId: "js-fetch" }))
      .mockResolvedValueOnce(response(outlinePayload));

    await bootstrap({ root, fetchImpl });
    expect(root.querySelector("[data-action=lesson-outline]").hidden).toBe(false);
    root.querySelector("[data-action=lesson-outline]").click();

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/courses/js-fetch/outline");
  });

  it("shows one completed fragment read-only and returns to the current block", async () => {
    const root = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/course/js-fetch",
      pretendToBeVisual: true,
    }).window.document;
    root.defaultView.scrollTo = vi.fn();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ ...baseView, courseId: "js-fetch" }))
      .mockResolvedValueOnce(response(outlinePayload))
      .mockResolvedValueOnce(response(reviewPayload))
      .mockResolvedValueOnce(response({ ...baseView, courseId: "js-fetch" }));

    await bootstrap({ root, fetchImpl });
    root.querySelector("[data-action=lesson-outline]").click();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-outline-unit-status="completed"]')).not.toBeNull();
    });
    root.querySelector('[data-outline-unit-status="completed"]').click();

    await vi.waitFor(() => {
      expect(root.querySelector('[data-screen="review"]').hidden).toBe(false);
    });
    const reviewScreen = root.querySelector('[data-screen="review"]');
    expect(reviewScreen.textContent).toContain("Сохранённый материал одного фрагмента");
    for (const selector of [
      "[data-role=question-panel]",
      "[data-role=lesson-actions]",
      "[data-role=clarification]",
      "[data-role=practice]",
      "[data-role=application]",
      "[data-role=lesson-size]",
    ]) {
      expect(reviewScreen.querySelector(selector)).toBeNull();
    }

    root.querySelector('[data-outline-action="return-current"]').click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5));
    await vi.waitFor(() => {
      expect(root.querySelector('[data-screen="lesson"]').hidden).toBe(false);
    });
    expect(fetchImpl.mock.calls[4][0]).toBe("/api/courses/js-fetch/session");
    expect(root.defaultView.scrollTo).toHaveBeenCalled();
  });

  it("builds and parses safe direct course routes", () => {
    expect(coursePath("js-fetch")).toBe("/course/js-fetch");
    expect(courseIdFromPath("/course/js-fetch")).toBe("js-fetch");
    expect(courseIdFromPath("/course/../secret")).toBeNull();
  });

  it("loads the catalog at root and a scoped session on a direct course URL", async () => {
    const catalogDocument = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/",
    }).window.document;
    const catalogFetch = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ lastCourseId: null, courses: [] }));
    await bootstrap({ root: catalogDocument, fetchImpl: catalogFetch });
    expect(catalogFetch.mock.calls.map(([url]) => url)).toEqual(["/api/ai/profiles", "/api/courses"]);

    const courseDocument = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/course/js-fetch",
    }).window.document;
    const courseFetch = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ ...baseView, courseId: "js-fetch" }));
    await bootstrap({ root: courseDocument, fetchImpl: courseFetch });
    expect(courseFetch.mock.calls.map(([url]) => url))
      .toEqual(["/api/ai/profiles", "/api/courses/js-fetch/session"]);
  });

  it("shows all approved profiles and disables GLM without its local key", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ lastCourseId: null, courses: [] }));

    await bootstrap({ root: document, fetchImpl });

    const selector = document.querySelector("[data-role=ai-profile-select]");
    expect([...selector.options].map((option) => option.textContent)).toEqual([
      "Codex · Terra · Medium",
      "Codex · Sol · Very High",
      "GLM · 5.2 · Max",
      "GLM · 5-Turbo",
    ]);
    expect(selector.value).toBe("codex-terra-medium");
    expect(selector.options[2].disabled).toBe(true);
    expect(selector.options[2].title).toBe("Добавь ZAI_API_KEY в .env.local");
  });

  it("persists a profile selection without reloading the open course", async () => {
    const selected = { ...aiProfiles, selectedProfileId: "codex-sol-xhigh" };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ ...baseView, courseId: "js-fetch" }))
      .mockResolvedValueOnce(response(selected));
    document.defaultView.history.replaceState({}, "", "/course/js-fetch");

    await bootstrap({ root: document, fetchImpl });
    const selector = document.querySelector("[data-role=ai-profile-select]");
    selector.value = "codex-sol-xhigh";
    selector.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(fetchImpl.mock.calls[2][0]).toBe("/api/ai/profile");
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ profileId: "codex-sol-xhigh" });
    expect(selector.value).toBe("codex-sol-xhigh");
    expect(document.defaultView.location.pathname).toBe("/course/js-fetch");
  });

  it("opens a course from the catalog and returns through All courses without reset", async () => {
    const root = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/",
    }).window.document;
    const catalog = {
      lastCourseId: null,
      courses: [{
        id: "js-fetch",
        title: "JS Fetch",
        summary: "Практические запросы к внешнему API.",
        availability: "available",
        lifecycleStatus: "in-progress",
        completedUnits: 17,
        totalUnits: 50,
        progress: 0.34,
        currentTitle: "response.ok",
      }],
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response(catalog))
      .mockResolvedValueOnce(response({ ...baseView, courseId: "js-fetch" }))
      .mockResolvedValueOnce(response(catalog));

    await bootstrap({ root, fetchImpl });
    root.querySelector("[data-action=open-course]").click();
    await vi.waitFor(() => expect(root.defaultView.location.pathname).toBe("/course/js-fetch"));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(root.querySelector('[data-screen="lesson"]').hidden).toBe(false);

    root.querySelector("[data-action=all-courses]").click();
    await vi.waitFor(() => expect(root.defaultView.location.pathname).toBe("/"));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.map(([url]) => url)).not.toContain("/api/reset");
  });

  it("renders the current lesson and keeps next disabled", () => {
    render(baseView, document);
    expect(document.querySelector("[data-role=lesson-title]").textContent)
      .toContain("AGENTS.md");
    expect(document.querySelector("[data-action=next]").disabled).toBe(true);
    expect(document.querySelectorAll("[data-choice]")).toHaveLength(3);
  });

  it("shows the next preserved question inside a multi-fragment block", () => {
    render({
      ...baseView,
      questionPosition: 2,
      questionCount: 5,
      remainingQuestionCount: 3,
      nextAction: "question",
      status: "reviewed",
      canGoNext: true,
      answer: { choice: "Б", correct: true, explanation: "Ответ сохранён." },
    }, document);

    expect(document.querySelector("[data-role=question-kicker]").textContent).toBe("Вопрос 2 из 5");
    expect(document.querySelector("[data-action=next]").textContent).toBe("Следующий вопрос");
    expect(document.querySelector("[data-role=status-line]").textContent)
      .toBe("Ответ разобран, далее вопрос 3 из 5");
  });

  it("keeps the viewport on the question panel between questions in a block", async () => {
    const nextQuestionView = {
      ...baseView,
      questionPosition: 2,
      questionCount: 3,
      remainingQuestionCount: 1,
      nextAction: "question",
      status: "awaiting-answer",
      canGoNext: false,
      answer: null,
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(nextQuestionView));
    render({
      ...baseView,
      status: "reviewed",
      canGoNext: true,
      answer: { choice: "А", correct: true, explanation: "Верно." },
    }, document);
    const viewWindow = document.defaultView;
    viewWindow.scrollTo = vi.fn();
    const questionPanel = document.querySelector("[data-role=question-panel]");
    questionPanel.scrollIntoView = vi.fn();
    wireActions({ root: document, fetchImpl });

    document.querySelector("[data-action=next]").click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=question-kicker]").textContent)
        .toBe("Вопрос 2 из 3");
    });
    expect(questionPanel.scrollIntoView).toHaveBeenCalled();
    expect(viewWindow.scrollTo).not.toHaveBeenCalled();
  });

  it("renders section headings and factual size controls", () => {
    const view = {
      ...baseView,
      actualSize: 3,
      canIncrease: false,
      canDecrease: true,
      sectionGroups: [
        { id: "durable-workflow", title: "Постоянные правила и среда", units: [
          baseView.units[0],
          { id: "bp-04", title: "Настройка среды", coreText: "Проектные разрешения." },
        ] },
        { id: "validation", title: "Проверка результата", units: [
          { id: "bp-05", title: "Проверка и ревью", coreText: "Тесты и diff." },
        ] },
      ],
    };
    render(view, document);
    expect(document.querySelector("[data-role=fragment-count]").textContent).toBe("3");
    expect([...document.querySelectorAll(".lesson-section-title")].map((node) => node.textContent))
      .toEqual(["Постоянные правила и среда", "Проверка результата"]);
    expect(document.querySelector("[data-action=increase]").disabled).toBe(true);
    expect(document.querySelector("[data-action=decrease]").disabled).toBe(false);
  });

  it("renders coreText paragraphs as separate elements", () => {
    const unit = makeUniversalCourse({ withCoreText: true }).units[0];
    render({
      ...baseView,
      units: [unit],
      sectionGroups: [{ id: "foundation", title: "Основа", units: [unit] }],
    }, document);

    const paragraphs = document.querySelectorAll(".lesson-copy-text p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toContain("Первый абзац");
    expect(paragraphs[1].textContent).toContain("Второй абзац");
  });

  it("renders **bold** coreText as strong inside a paragraph", () => {
    const unit = makeUniversalCourse({ withCoreText: true }).units[0];
    render({
      ...baseView,
      units: [unit],
      sectionGroups: [{ id: "foundation", title: "Основа", units: [unit] }],
    }, document);

    const strong = document.querySelector(".lesson-copy-text p strong");
    expect(strong).not.toBeNull();
    expect(strong.textContent).toBe("ключевую мысль");
  });

  it("escapes html inside coreText instead of injecting it", () => {
    const unit = makeUniversalCourse({ withCoreText: true }).units[0];
    render({
      ...baseView,
      units: [unit],
      sectionGroups: [{ id: "foundation", title: "Основа", units: [unit] }],
    }, document);

    const copy = document.querySelector(".lesson-copy-text");
    expect(copy.querySelector("script")).toBeNull();
    expect(copy.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders four safe artifact kinds in unit order with an image fallback", () => {
    const sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const units = [
      { id: "unit-image", title: "Рисунок", coreText: "Текст рисунка.", artifactRefs: ["figure-map"] },
      { id: "unit-table", title: "Таблица", coreText: "Текст таблицы.", artifactRefs: ["table-map"] },
      { id: "unit-code", title: "Листинг", coreText: "Текст листинга.", artifactRefs: ["listing-map"] },
      { id: "unit-formula", title: "Формула", coreText: "Текст формулы.", artifactRefs: ["formula-map"] },
    ];
    render({
      ...baseView,
      units,
      actualSize: units.length,
      sectionGroups: [{ id: "artifacts", title: "Артефакты", units }],
      sourceArtifacts: [
        {
          id: "figure-map",
          caption: "Подпись <img src=x onerror=alert(1)>",
          content: { type: "image", fileName: "foundation-map.png", alt: "Схема <основы>", sha256 },
        },
        {
          id: "table-map",
          caption: "Сводная таблица.",
          content: {
            type: "table",
            columns: ["Часть", "Назначение"],
            rows: [["<script>alert(1)</script>", "Проверка"]],
            align: ["left", "right"],
          },
        },
        {
          id: "listing-map",
          caption: "Безопасный листинг.",
          content: { type: "code", language: "text", text: "<script>alert(1)</script>\nverify()" },
        },
        {
          id: "formula-map",
          caption: "Формула результата.",
          content: { type: "formula", text: "Result = Goal < Evidence" },
        },
      ],
    }, document);

    const artifacts = [...document.querySelectorAll("[data-artifact-id]")];
    expect(artifacts.map((node) => node.dataset.artifactId))
      .toEqual(["figure-map", "table-map", "listing-map", "formula-map"]);

    const image = document.querySelector("[data-artifact-image]");
    expect(image.getAttribute("src"))
      .toBe(`/api/courses/best-practices/assets/foundation-map.png?v=${sha256.slice(0, 12)}`);
    expect(image.getAttribute("alt")).toBe("Схема <основы>");
    expect(document.querySelector(".lesson-artifact figcaption").textContent)
      .toBe("Подпись <img src=x onerror=alert(1)>");

    expect(document.querySelectorAll(".lesson-artifact table th")).toHaveLength(2);
    expect(document.querySelectorAll(".lesson-artifact table td")).toHaveLength(2);
    expect(document.querySelector(".lesson-artifact table").textContent)
      .toContain("<script>alert(1)</script>");
    expect(document.querySelector(".lesson-artifact code").textContent)
      .toContain("<script>alert(1)</script>");
    expect(document.querySelector(".lesson-formula").textContent)
      .toBe("Result = Goal < Evidence");
    expect(document.querySelector(".lesson-copy script")).toBeNull();

    const fallback = document.querySelector("[data-artifact-fallback]");
    expect(fallback.hidden).toBe(true);
    image.dispatchEvent(new document.defaultView.Event("error"));
    expect(image.hidden).toBe(true);
    expect(fallback.hidden).toBe(false);
    expect(fallback.textContent).toContain("Иллюстрация временно недоступна");

    expect(document.querySelector("[data-action=detail]").disabled).toBe(false);
    expect(document.querySelector("[data-action=practice]").disabled).toBe(false);
    expect(document.querySelector("[data-action=increase]").disabled).toBe(false);
  });

  it("does not present the obsolete max-size reason", () => {
    render({
      ...baseView,
      actualSize: 5,
      canIncrease: true,
      sizeLimitReason: "max-size",
    }, document);
    expect(document.querySelector("[data-role=size-limit]").textContent).toBe("");
    expect(document.querySelector("[data-action=increase]").disabled).toBe(false);
  });

  it("labels the real course end", () => {
    render({
      ...baseView,
      actualSize: 2,
      canIncrease: false,
      sizeLimitReason: "article-end",
    }, document);
    expect(document.querySelector("[data-role=size-limit]").textContent).toBe("Конец курса");
    expect(document.querySelector("[data-action=increase]").title).toBe("Конец курса");
  });

  it("uses a fragment range for a large block title", () => {
    const units = Array.from({ length: 5 }, (_, index) => ({
      id: `unit-${index + 1}`,
      title: `Очень подробный заголовок фрагмента ${index + 1}`,
      coreText: `Текст ${index + 1}`,
    }));
    render({
      ...baseView,
      cursor: 2,
      units,
      actualSize: 5,
      sectionGroups: [{ id: "section", title: "Раздел", units }],
    }, document);
    expect(document.querySelector("[data-role=lesson-title]").textContent)
      .toBe("Фрагменты 3-7");
  });

  it("enables next after a reviewed answer", async () => {
    const reviewed = {
      ...baseView,
      status: "reviewed",
      answer: { explanation: "Это конкретное повторяемое правило." },
      canGoNext: true,
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(reviewed));
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector('[data-choice="А"]').click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-action=next]").disabled).toBe(false);
    });
  });

  it("scrolls the next lesson title below the sticky header", async () => {
    const nextView = {
      ...baseView,
      cursor: 3,
      units: [{ id: "bp-04", title: "Настройка среды", coreText: "Узкие разрешения." }],
      sectionGroups: [{
        id: "durable-workflow",
        title: "Постоянные правила и среда",
        units: [{ id: "bp-04", title: "Настройка среды", coreText: "Узкие разрешения." }],
      }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(nextView));
    render({
      ...baseView,
      status: "reviewed",
      answer: { choice: "А", correct: true, explanation: "Верно." },
      canGoNext: true,
    }, document);
    const viewWindow = document.defaultView;
    const lessonTitle = document.querySelector("[data-role=lesson-title]");
    const header = document.querySelector(".course-header");
    vi.spyOn(lessonTitle, "getBoundingClientRect").mockReturnValue({ top: 420 });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ height: 100 });
    Object.defineProperty(viewWindow, "scrollY", { configurable: true, value: 900 });
    viewWindow.scrollTo = vi.fn();
    wireActions({ root: document, fetchImpl });

    document.querySelector("[data-action=next]").click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=lesson-title]").textContent)
        .toBe("Настройка среды");
    });
    expect(viewWindow.scrollTo).toHaveBeenCalledWith({
      top: 1200,
      behavior: "smooth",
    });
  });

  it("uses instant next-block scrolling when reduced motion is requested", async () => {
    const nextView = {
      ...baseView,
      cursor: 3,
      units: [{ id: "bp-04", title: "Настройка среды", coreText: "Узкие разрешения." }],
      sectionGroups: [{
        id: "durable-workflow",
        title: "Постоянные правила и среда",
        units: [{ id: "bp-04", title: "Настройка среды", coreText: "Узкие разрешения." }],
      }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(nextView));
    render({
      ...baseView,
      status: "reviewed",
      answer: { choice: "А", correct: true, explanation: "Верно." },
      canGoNext: true,
    }, document);
    const viewWindow = document.defaultView;
    const lessonTitle = document.querySelector("[data-role=lesson-title]");
    const header = document.querySelector(".course-header");
    vi.spyOn(lessonTitle, "getBoundingClientRect").mockReturnValue({ top: 200 });
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ height: 80 });
    Object.defineProperty(viewWindow, "scrollY", { configurable: true, value: 600 });
    viewWindow.matchMedia = vi.fn().mockReturnValue({ matches: true });
    viewWindow.scrollTo = vi.fn();
    wireActions({ root: document, fetchImpl });

    document.querySelector("[data-action=next]").click();

    await vi.waitFor(() => expect(viewWindow.scrollTo).toHaveBeenCalled());
    expect(viewWindow.matchMedia)
      .toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(viewWindow.scrollTo).toHaveBeenCalledWith({
      top: 700,
      behavior: "auto",
    });
  });

  it("does not scroll when loading the next block fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      message: "Не удалось открыть следующий блок.",
    }, false));
    render({
      ...baseView,
      status: "reviewed",
      answer: { choice: "А", correct: true, explanation: "Верно." },
      canGoNext: true,
    }, document);
    const viewWindow = document.defaultView;
    viewWindow.scrollTo = vi.fn();
    wireActions({ root: document, fetchImpl });

    document.querySelector("[data-action=next]").click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=error]").hidden).toBe(false);
    });
    expect(viewWindow.scrollTo).not.toHaveBeenCalled();
  });

  it("posts the selected practical application", async () => {
    const applicationView = {
      ...baseView,
      units: [],
      question: null,
      status: "awaiting-application",
      application: {
        prompt: "Что применишь?",
        choices: { "А": "Первое", "Б": "Второе", "В": "Третье" },
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(response({
      ...applicationView,
      status: "complete",
      application: null,
      applicationChoice: "В",
    }));
    render(applicationView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector('[data-application-choice="В"]').click();

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const [path, options] = fetchImpl.mock.calls[0];
    expect(path).toBe("/api/courses/best-practices/application");
    expect(JSON.parse(options.body)).toEqual({ choice: "В" });
  });

  it("shows a retry after timeout without clearing the current lesson", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      message: "Codex не ответил вовремя. Основной урок остаётся доступным.",
    }, false));
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector("[data-action=detail]").click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=error]").hidden).toBe(false);
    });
    expect(document.querySelector("[data-role=lesson-title]").textContent).toContain("AGENTS.md");
    expect(document.querySelector("[data-action=retry]").hidden).toBe(false);
    document.querySelector("[data-action=retry]").click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it("shows explicit progress while practice generation is pending", async () => {
    let resolveRequest;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    const practiceView = {
      ...baseView,
      practice: {
        kind: "practice",
        task: "Сформулируй постоянное правило проекта.",
        expectedMinutes: 3,
        evaluationGuide: "Правило конкретно.",
      },
    };
    const fetchImpl = vi.fn(() => pending);
    const practicePanel = document.querySelector("[data-role=practice]");
    practicePanel.scrollIntoView = vi.fn();
    document.body.dataset.aiProfileLabel = "Codex · Terra · Medium";
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector("[data-action=practice]").click();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-role=action-status]")).not.toBeNull();
    expect(document.querySelector("[data-role=action-status]").hidden).toBe(false);
    expect(document.querySelector("[data-role=action-status]").textContent)
      .toBe("Codex · Terra · Medium готовит практику…");
    expect(document.querySelector("[data-action=practice]").getAttribute("aria-busy"))
      .toBe("true");
    expect(document.querySelector("[data-action=detail]").disabled).toBe(true);
    expect(document.querySelector("[data-role=ai-profile-select]").disabled).toBe(true);

    resolveRequest(response(practiceView));
    await vi.waitFor(() => {
      expect(practicePanel.hidden).toBe(false);
    });
    expect(practicePanel.scrollIntoView)
      .toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.querySelector("[data-action=detail]").disabled).toBe(false);
    expect(document.querySelector("[data-role=action-status]").hidden).toBe(true);
    expect(document.querySelector("[data-action=practice]").hasAttribute("aria-busy"))
      .toBe(false);
  });

  it("recovers a practice already saved after the POST response is lost", async () => {
    const practiceView = {
      ...baseView,
      practice: {
        kind: "practice",
        task: "Сформулируй постоянное правило проекта.",
        expectedMinutes: 3,
        evaluationGuide: "Правило конкретно.",
      },
    };
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("Ответ соединения потерян"))
      .mockResolvedValueOnce(response(practiceView));
    const practicePanel = document.querySelector("[data-role=practice]");
    practicePanel.scrollIntoView = vi.fn();
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector("[data-action=practice]").click();

    await vi.waitFor(() => expect(practicePanel.hidden).toBe(false));
    expect(fetchImpl.mock.calls.map(([path]) => path))
      .toEqual(["/api/courses/best-practices/practice", "/api/courses/best-practices/session"]);
    expect(document.querySelector("[data-role=error]").hidden).toBe(true);
    expect(document.querySelector("[data-action=detail]").disabled).toBe(false);
    expect(practicePanel.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("restores buttons and shows the original error when practice recovery also fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Codex недоступен"));
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector("[data-action=practice]").click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=error]").hidden).toBe(false);
    });
    expect(fetchImpl.mock.calls.map(([path]) => path))
      .toEqual(["/api/courses/best-practices/practice", "/api/courses/best-practices/session"]);
    expect(document.querySelector("[data-role=error-message]").textContent)
      .toBe("Codex недоступен");
    expect(document.querySelector("[data-action=detail]").disabled).toBe(false);
    expect(document.querySelector("[data-action=practice]").disabled).toBe(false);
    expect(document.querySelector("[data-role=action-status]").hidden).toBe(true);
  });

  it("re-enables the AI actions after a successful resize", async () => {
    const resized = {
      ...baseView,
      actualSize: 2,
      canIncrease: true,
      canDecrease: true,
      units: [
        ...baseView.units,
        { id: "bp-04", title: "Настройка среды", coreText: "Узкие проектные разрешения." },
      ],
      sectionGroups: [{
        id: "durable-workflow",
        title: "Постоянные правила и среда",
        units: [
          ...baseView.units,
          { id: "bp-04", title: "Настройка среды", coreText: "Узкие проектные разрешения." },
        ],
      }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(resized));
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector("[data-action=increase]").click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=fragment-count]").textContent).toBe("2");
    });
    expect(document.querySelector("[data-action=detail]").disabled).toBe(false);
    expect(document.querySelector("[data-action=practice]").disabled).toBe(false);
    expect(document.querySelector("[data-action=rephrase]").disabled).toBe(false);
  });

  it("keeps the practice feedback visible after review", async () => {
    const practiceView = {
      ...baseView,
      practice: {
        kind: "practice",
        task: "Сформулируй постоянное правило проекта.",
        expectedMinutes: 3,
        evaluationGuide: "Правило конкретно.",
      },
    };
    const reviewedPractice = {
      ...practiceView,
      practice: null,
      practiceHistory: [{
        practice: practiceView.practice,
        userAnswer: "Не открывай .env.",
        review: {
          kind: "practice-review",
          correct: true,
          feedback: "Правило конкретное и повторяемое.",
          nextHint: "Проверь его на следующей задаче.",
        },
      }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(reviewedPractice));
    render(practiceView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector("[data-role=practice-answer]").value = "Не открывай .env.";
    document.querySelector("[data-action=practice-review]").click();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=practice-feedback]").textContent)
        .toContain("Правило конкретное");
    });
    expect(document.querySelector("[data-role=practice]").hidden).toBe(false);
  });

  it("hides old practice history on the completion screen", () => {
    const complete = {
      ...baseView,
      units: [],
      question: null,
      status: "complete",
      applicationChoice: "В",
      practiceHistory: [{
        practice: { task: "Старая практика" },
        review: { correct: true, feedback: "Проверено", nextHint: "Готово" },
      }],
    };
    render(complete, document);
    expect(document.querySelector("[data-role=practice]").hidden).toBe(true);
    expect(document.querySelector("[data-role=completion]").hidden).toBe(false);
  });

  it("renders an optional prepared activity without locking the local answer", () => {
    render({
      ...baseView,
      activities: [{
        unitId: "bp-03",
        title: "Проверь правило",
        instructions: ["Открой тестовый проект.", "Проверь один безопасный результат."],
        expectedResult: "Виден ожидаемый результат без секретов.",
        confirmationPrompt: "Коротко опиши результат.",
        completed: false,
        result: null,
      }],
    }, document);

    expect(document.querySelector("[data-role=prepared-activities]").hidden).toBe(false);
    expect(document.body.textContent).toContain("Проверь правило");
    expect(document.querySelector("[data-activity-result]")).not.toBeNull();
    expect(document.querySelector('[data-choice="А"]').disabled).toBe(false);
  });

  it("renders clarification messages and a context-change marker", () => {
    render({
      ...baseView,
      clarificationThread: {
        courseId: "best-practices",
        cursor: 2,
        messages: [
          { role: "user", text: "Почему?" },
          {
            role: "assistant",
            text: "Потому что правило повторяется.",
            basis: "course",
            generatedBy: { profileId: "zai-glm-5-2-max", label: "GLM · 5.2 · Max" },
          },
          { role: "context-change", fromUnitIds: ["bp-03"], toUnitIds: ["bp-03", "bp-04", "bp-05"] },
        ],
      },
    }, document);
    expect(document.querySelector("[data-role=clarification-messages]").textContent)
      .toContain("Потому что правило повторяется.");
    expect(document.querySelector("[data-role=clarification-messages]").textContent)
      .toContain("Размер блока изменён: 1 → 3");
    expect(document.querySelector(".clarification-basis").textContent).toContain("По материалу курса");
    expect(document.querySelector(".clarification-message.is-assistant strong").textContent)
      .toContain("GLM · 5.2 · Max");
  });

  it("shows saved profile attribution on layers, practice, and review", () => {
    const generatedBy = { profileId: "codex-sol-xhigh", label: "Codex · Sol · Very High" };
    render({
      ...baseView,
      layers: [{
        kind: "detail",
        explanation: "Подробное объяснение текущего учебного материала.",
        example: "Конкретный пример для практического применения.",
        caveat: "Проверяй результат в живом проекте.",
        generatedBy,
      }],
      practice: {
        kind: "practice",
        task: "Сформулируй короткое проверяемое правило.",
        expectedMinutes: 3,
        evaluationGuide: "Есть правило и проверка.",
        generatedBy,
      },
      practiceHistory: [{
        practice: { task: "Старая практика" },
        review: { correct: true, feedback: "Хорошо объяснено.", nextHint: "Продолжай.", generatedBy },
      }],
    }, document);

    expect(document.querySelector("[data-role=layers]").textContent).toContain("Codex · Sol · Very High");
    expect(document.querySelector("[data-role=practice-model]").textContent).toContain("Codex · Sol · Very High");
    expect(document.querySelector("[data-role=practice-feedback]").textContent).toContain("Codex · Sol · Very High");
  });

  it("submits clarification with Enter and clears only after success", async () => {
    const answered = {
      ...baseView,
      clarificationThread: {
        ...baseView.clarificationThread,
        messages: [
          { role: "user", text: "Почему?" },
          { role: "assistant", text: "Понятный ответ модели.", basis: "mixed" },
        ],
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(response(answered));
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    const input = document.querySelector("[data-role=clarification-input]");
    input.value = "Почему?";
    input.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ question: "Почему?" });
    await vi.waitFor(() => expect(input.value).toBe(""));
  });

  it("keeps clarification text after a provider error", async () => {
    const answered = {
      ...baseView,
      clarificationThread: {
        ...baseView.clarificationThread,
        messages: [{ role: "assistant", text: "Ответ после повтора.", basis: "course" }],
      },
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ message: "Codex временно недоступен." }, false))
      .mockResolvedValueOnce(response(answered));
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    const input = document.querySelector("[data-role=clarification-input]");
    input.value = "Не потеряй этот вопрос";
    document.querySelector("[data-action=clarification-submit]").click();
    await vi.waitFor(() => expect(document.querySelector("[data-role=error]").hidden).toBe(false));
    expect(input.value).toBe("Не потеряй этот вопрос");
    document.querySelector("[data-action=retry]").click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(input.value).toBe(""));
  });

  it("keeps Shift+Enter inside the clarification field", () => {
    const fetchImpl = vi.fn();
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    const input = document.querySelector("[data-role=clarification-input]");
    input.value = "Первая строка";
    input.dispatchEvent(new document.defaultView.KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows clarification progress and blocks conflicting controls", async () => {
    let resolveFetch;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    render(baseView, document);
    document.body.dataset.aiProfileLabel = "Codex · Terra · Medium";
    wireActions({ root: document, fetchImpl });
    const input = document.querySelector("[data-role=clarification-input]");
    input.value = "Почему?";
    document.querySelector("[data-action=clarification-submit]").click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect(input.disabled).toBe(true);
    expect(document.querySelector("[data-action=increase]").disabled).toBe(true);
    expect(document.querySelector("[data-role=clarification-status]").hidden).toBe(false);
    expect(document.querySelector("[data-role=clarification-status]").textContent)
      .toBe("Codex · Terra · Medium отвечает…");
    expect(document.querySelector("[data-role=ai-profile-select]").disabled).toBe(true);
    resolveFetch(response(baseView));
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    expect(document.querySelector("[data-role=clarification-status]").hidden).toBe(true);
  });

  it("switches theme locally without an API request", () => {
    const fetchImpl = vi.fn();
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const media = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    initThemeControl({
      root: document.documentElement,
      button: document.querySelector("[data-role=theme-toggle]"),
      storage,
      media,
    });

    document.querySelector("[data-role=theme-toggle]").click();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the chosen theme across lesson renders", () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
    render(baseView, document);
    render({ ...baseView, targetSize: 2 }, document);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("keeps the theme button available while lesson actions are busy", async () => {
    let resolveFetch;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    render(baseView, document);
    wireActions({ root: document, fetchImpl });
    document.querySelector("[data-action=detail]").click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect(document.querySelector("[data-role=theme-toggle]").disabled).toBe(false);
    expect(document.querySelector("[data-action=all-courses]").disabled).toBe(true);
    resolveFetch(response(baseView));
  });

  it("initializes the theme controller before loading the session", async () => {
    const source = await fs.readFile("public/app.js", "utf8");
    const bootstrapSource = source.slice(source.indexOf("export async function bootstrap"));
    expect(source).toContain('import { initThemeControl } from "./theme.js";');
    expect(bootstrapSource.indexOf("initThemeControl({"))
      .toBeLessThan(bootstrapSource.indexOf("routeFromLocation"));
  });
});
