import { largeRoadmapDocument } from "./fixtures/large-roadmap.js";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCourseOutlineController,
} from "../public/course-outline.js";
import * as outlineModule from "../public/course-outline.js";
import { API_VERSION } from "../src/app-identity.js";

const outline = {
  appId: "adaptive-codex-learning",
  apiVersion: 10,
  courseId: "sample-article",
  title: "Универсальная статья",
  progress: { completed: 1, total: 4 },
  sections: [
    {
      id: "foundation",
      title: "Основа",
      order: 1,
      progress: { completed: 1, total: 2 },
      containsCurrent: true,
      units: [
        { id: "foundation-goal", title: "Цель", order: 1, status: "completed" },
        { id: "foundation-context", title: "Контекст", order: 2, status: "current" },
      ],
    },
    {
      id: "practice",
      title: "Практика",
      order: 2,
      progress: { completed: 0, total: 2 },
      containsCurrent: true,
      units: [
        { id: "practice-plan", title: "План", order: 3, status: "current" },
        { id: "practice-test", title: "Проверка", order: 4, status: "locked" },
      ],
    },
  ],
};

const review = {
  appId: "adaptive-codex-learning",
  apiVersion: 10,
  courseId: "sample-article",
  courseTitle: "Универсальная статья",
  section: { id: "foundation", title: "Основа" },
  unit: {
    id: "foundation-goal",
    title: "Цель",
    coreText: "Пройденный текст.",
  },
  sourceArtifacts: [],
};

const videoOutline = {
  appId: "adaptive-codex-learning",
  apiVersion: API_VERSION,
  courseId: "video-course",
  title: "Видеокурс",
  progress: { completed: 0, total: 1 },
  prepared: { completed: 0, total: 1 },
  chapterPreparation: { ready: 1, total: 2 },
  sections: [{
    id: "video-chapters",
    title: "Главы видео",
    order: 1,
    progress: { completed: 0, total: 1 },
    containsCurrent: true,
    units: [
      { id: "introduction", title: "Introduction", order: 1, status: "current" },
      { id: "orca-workspace", title: "Orca workspace", order: 2, status: "planned" },
    ],
  }],
};

const roadmapOutline = {
  ...outline,
  roadmap: {
    id: "agent-workflow",
    title: "Агенты",
    progress: { completed: 1, prepared: 2, total: 3 },
    sections: [{
      id: "module-one",
      title: "Модуль 1",
      order: 1,
      containsCurrent: true,
      items: [
        { id: "introduction", title: "Введение", order: 1, status: "completed", courseId: "intro-course" },
        { id: "chapter-one", title: "Глава 1", order: 2, status: "current", courseId: "sample-article" },
        { id: "chapter-two", title: "Глава 2", order: 3, status: "planned" },
      ],
    }],
  },
};

async function fullAgentsRoadmapOutline() {
  const document = largeRoadmapDocument();
  const roadmap = document.roadmaps.find((item) => item.id === "agenty-i-vajbkoding");
  return {
    ...structuredClone(outline),
    courseId: "agenty-i-vajbkoding-chapter-1",
    roadmap: {
      ...roadmap,
      progress: { completed: 1, prepared: 10, total: 47 },
      sections: roadmap.sections.map((section) => ({
        ...section,
        containsCurrent: section.items.some((item) => item.courseId === "agenty-i-vajbkoding-chapter-1"),
        items: section.items.map((item) => ({
          ...item,
          status: item.courseId === "agenty-i-vajbkoding-introduction-pilot"
            ? "completed"
            : item.courseId === "agenty-i-vajbkoding-chapter-1"
              ? "current"
              : "planned",
        })),
      })),
    },
  };
}

let document;
let request;
let onOpenCurrentCourse;
let onShowReview;
let onReturnCurrent;
let controller;
let catalogButton;

beforeEach(async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  document = new JSDOM(html, {
    url: "http://127.0.0.1:4173/",
    pretendToBeVisual: true,
  }).window.document;
  catalogButton = document.createElement("button");
  catalogButton.textContent = "Содержание";
  document.body.append(catalogButton);
  request = vi.fn(async (path) => (
    path.includes("/review/") ? structuredClone(review) : structuredClone(outline)
  ));
  onOpenCurrentCourse = vi.fn();
  onShowReview = vi.fn();
  onReturnCurrent = vi.fn();
  controller = createCourseOutlineController({
    root: document,
    request,
    onOpenCurrentCourse,
    onShowReview,
    onReturnCurrent,
  });
});

const openArgs = () => ({
  courseId: "sample-article",
  origin: "catalog",
  trigger: catalogButton,
});

describe("course outline controller", () => {
  it("renders planned YouTube chapters disabled", () => {
    const html = outlineModule.outlineMarkup(videoOutline);
    expect(html).toContain("ещё не подготовлено");
    expect(html).toContain('data-outline-unit-status="planned"');
    expect(html).toContain("disabled");
  });

  it("renders a full roadmap while keeping future chapters disabled", () => {
    const html = outlineModule.outlineMarkup({
      ...roadmapOutline,
      expandedRoadmapSectionIds: new Set(["module-one"]),
    });
    expect(html).toContain("Полный маршрут: Агенты");
    expect(html).toContain("Фрагменты этой части");
    expect(html).toContain("В системе");
    expect(html).toContain("Запланировано");
    expect(html).toContain('data-course-id="intro-course"');
    expect(html).toContain('data-roadmap-presence="published"');
    expect(html).toContain('data-roadmap-presence="planned"');
    expect(html).toContain('data-roadmap-item-status="planned"');
    expect(html).toContain("disabled");
  });

  it("loads fresh outline data for every open", async () => {
    await controller.open(openArgs());
    controller.close();
    await controller.open(openArgs());

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/courses/sample-article/outline",
    );
  });

  it("renders detailed progress and expands every current section", async () => {
    await controller.open(openArgs());

    expect(document.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(document.querySelector('[data-role="outline-course-progress"]').textContent)
      .toContain("1 из 4");
    expect([...document.querySelectorAll("[data-outline-section-body]")]
      .every((section) => !section.hidden)).toBe(true);
    expect(document.querySelectorAll('[data-outline-unit-status="current"]'))
      .toHaveLength(2);
  });

  it("opens only completed units in review mode", async () => {
    await controller.open(openArgs());
    document.querySelector('[data-outline-unit-status="completed"]').click();

    await vi.waitFor(() => expect(onShowReview).toHaveBeenCalledOnce());
    expect(request.mock.calls[1][0])
      .toBe("/api/courses/sample-article/review/foundation-goal");
    expect(document.querySelector('[data-screen="review"] [data-role="review-content"]').textContent)
      .toContain("Пройденный текст");
  });

  it("does not request locked content", async () => {
    await controller.open(openArgs());
    const locked = document.querySelector('[data-outline-unit-status="locked"]');

    expect(locked.disabled).toBe(true);
    locked.click();
    expect(request).toHaveBeenCalledOnce();
  });

  it("returns a catalog current item to the full current block", async () => {
    await controller.open(openArgs());
    document.querySelector('[data-outline-unit-status="current"]').click();

    await vi.waitFor(() => expect(onOpenCurrentCourse)
      .toHaveBeenCalledWith("sample-article"));
  });

  it("opens a prepared chapter from the roadmap only after an explicit click", async () => {
    request.mockResolvedValueOnce(structuredClone(roadmapOutline));
    await controller.open(openArgs());
    document.querySelector('[data-course-id="intro-course"]').click();

    await vi.waitFor(() => expect(onOpenCurrentCourse).toHaveBeenCalledWith("intro-course"));
    expect(document.querySelector("[data-role=course-outline]").hidden).toBe(true);
  });

  it("expands every full-roadmap section when the panel opens", async () => {
    request.mockResolvedValueOnce({
      ...structuredClone(roadmapOutline),
      roadmap: {
        ...structuredClone(roadmapOutline.roadmap),
        sections: [
          ...structuredClone(roadmapOutline.roadmap.sections),
          {
            id: "module-two",
            title: "Модуль 2",
            order: 2,
            containsCurrent: false,
            items: [{ id: "chapter-three", title: "Глава 3", order: 4, status: "planned" }],
          },
        ],
      },
    });

    await controller.open(openArgs());

    expect([...document.querySelectorAll("[data-roadmap-section-body]")]
      .every((section) => !section.hidden)).toBe(true);
    expect(document.querySelector("[data-roadmap-section=module-two]").textContent)
      .toContain("Глава 3");
  });

  it("shows every section and item of the published agents roadmap", async () => {
    request.mockResolvedValueOnce(await fullAgentsRoadmapOutline());

    await controller.open({ ...openArgs(), courseId: "agenty-i-vajbkoding-chapter-1" });

    expect(document.querySelectorAll("[data-roadmap-section]")).toHaveLength(13);
    expect(document.querySelectorAll('[data-outline-action="open-roadmap-item"]')).toHaveLength(47);
    expect(document.querySelectorAll("[data-roadmap-section-body][hidden]")).toHaveLength(0);
    expect(document.querySelectorAll('[data-roadmap-presence="published"]')).toHaveLength(10);
    expect(document.querySelectorAll('[data-roadmap-presence="planned"]')).toHaveLength(37);
    expect(document.querySelectorAll('[data-roadmap-item-status="planned"][disabled]')).toHaveLength(45);
  });

  it("closes a lesson current item without opening a unit", async () => {
    await controller.open({ ...openArgs(), origin: "lesson" });
    document.querySelector('[data-outline-unit-status="current"]').click();

    expect(onOpenCurrentCourse).not.toHaveBeenCalled();
    expect(document.querySelector("[data-role=course-outline]").hidden).toBe(true);
  });

  it("expands only the first section when a course has no current units", async () => {
    request.mockResolvedValueOnce({
      ...structuredClone(outline),
      sections: outline.sections.map((section) => ({
        ...structuredClone(section),
        containsCurrent: false,
        units: section.units.map((unit) => ({ ...unit, status: "completed" })),
      })),
    });

    await controller.open(openArgs());
    const bodies = [...document.querySelectorAll("[data-outline-section-body]")];
    expect(bodies[0].hidden).toBe(false);
    expect(bodies[1].hidden).toBe(true);
  });

  it("retries a local outline error without closing the panel", async () => {
    request
      .mockRejectedValueOnce(new Error("Оглавление временно недоступно"))
      .mockResolvedValueOnce(structuredClone(outline));

    await controller.open(openArgs());
    expect(document.querySelector("[data-role=outline-error]").hidden).toBe(false);
    document.querySelector('[data-outline-action="retry"]').click();

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(document.querySelector("[data-role=outline-error]").hidden).toBe(true);
    });
    expect(document.querySelector("[data-role=course-outline]").hidden).toBe(false);
  });

  it("closes with Escape and restores the trigger focus", async () => {
    catalogButton.focus();
    await controller.open(openArgs());
    document.dispatchEvent(new document.defaultView.KeyboardEvent(
      "keydown",
      { key: "Escape", bubbles: true },
    ));

    expect(document.querySelector("[data-role=course-outline]").hidden).toBe(true);
    expect(document.activeElement).toBe(catalogButton);
  });

  it("wraps keyboard focus inside the open dialog", async () => {
    await controller.open(openArgs());
    const drawer = document.querySelector(".outline-drawer");
    const focusable = [...drawer.querySelectorAll("button:not(:disabled), [tabindex]")];
    focusable.at(-1).focus();
    document.dispatchEvent(new document.defaultView.KeyboardEvent(
      "keydown",
      { key: "Tab", bubbles: true },
    ));

    expect(document.activeElement).toBe(focusable[0]);
  });
});
