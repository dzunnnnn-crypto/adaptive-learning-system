import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildVisibleLibraryItems, playlistCardMarkup } from "../public/playlist-library.js";
import { renderCatalog } from "../public/course-library.js";

function makePayload() {
  return {
    lastCourseId: "kiselev-lesson-2",
    courses: [
      {
        id: "kiselev-lesson-1",
        order: 10,
        title: "Данные CRM",
        archived: true,
        availability: "available",
        lifecycleStatus: "complete",
        completedUnits: 8,
        totalUnits: 8,
        progress: 1,
        addedAt: "2026-10-10",
      },
      {
        id: "kiselev-lesson-2",
        order: 12,
        title: "Техническое задание",
        availability: "available",
        lifecycleStatus: "in-progress",
        completedUnits: 3,
        totalUnits: 11,
        progress: 3 / 11,
        addedAt: "2026-10-11",
      },
      {
        id: "salt-lesson-1",
        order: 11,
        title: "Живая лента",
        availability: "available",
        lifecycleStatus: "waiting-content",
        completedUnits: 1,
        totalUnits: 5,
        progress: 0.2,
        addedAt: "2026-10-10",
      },
      {
        id: "standalone",
        order: 20,
        title: "Обычный курс",
        availability: "available",
        lifecycleStatus: "in-progress",
        completedUnits: 2,
        totalUnits: 5,
        progress: 0.4,
        addedAt: "2026-10-12",
      },
    ],
    playlists: [
      {
        kind: "youtube-playlist",
        id: "kiselev",
        title: "Битрикс24 · Киселёв",
        author: "Константин Киселёв",
        sourceUrl: "https://www.youtube.com/playlist?list=PLabc123",
        addedAt: "2026-10-10",
        order: 10,
        updatedAt: "2026-10-12T10:00:00.000Z",
        archived: false,
        lifecycleStatus: "complete",
        isLast: false,
        lessonCourseIds: ["kiselev-lesson-1", "kiselev-lesson-2"],
        progress: { completed: 1, total: 4, prepared: 2, partial: 0, ratio: 0.25 },
        current: null,
        navigationError: null,
      },
      {
        kind: "youtube-playlist",
        id: "salt",
        title: "Битрикс24 · Соль Академия",
        author: "Соль Академия",
        sourceUrl: "https://www.youtube.com/playlist?list=PLxyz123",
        addedAt: "2026-10-10",
        order: 11,
        updatedAt: "2026-10-12T09:00:00.000Z",
        archived: false,
        lifecycleStatus: "waiting-content",
        isLast: false,
        lessonCourseIds: ["salt-lesson-1", "salt-lesson-2"],
        progress: { completed: 0, total: 4, prepared: 0, partial: 1, ratio: 0 },
        current: { courseId: "salt-lesson-1", title: "Урок 1. Живая лента", chapterNumber: 6, chapterTotal: 6, readyChapters: 5 },
        navigationError: null,
      },
    ],
  };
}

describe("playlist library projection", () => {
  it("groups playlist children before filtering completed and archived courses", async () => {
    const payload = makePayload();
    const items = buildVisibleLibraryItems(payload);
    const dom = new JSDOM(await fs.readFile("public/index.html", "utf8"), { url: "http://127.0.0.1:4173" });
    renderCatalog(payload, dom.window.document);

    expect(items.filter(({ kind }) => kind === "youtube-playlist")).toHaveLength(2);
    expect(items.filter(({ kind }) => kind === "course")).toHaveLength(1);
    expect(items.find(({ id }) => id === "kiselev").category).toBe("completed");
    expect(dom.window.document.querySelectorAll("[data-playlist-card]")).toHaveLength(2);
    expect(dom.window.document.querySelectorAll("[data-course-card=kiselev-lesson-1], [data-course-card=kiselev-lesson-2], [data-course-card=salt-lesson-1]")).toHaveLength(0);
    expect(dom.window.document.querySelector("[data-role=completed-count]").textContent).toBe("1");
    expect(dom.window.document.querySelector("[data-role=course-grid]").textContent).toContain("Обычный курс");
  });

  it("keeps an archived completed child and a started child inside one parent card", () => {
    const payload = makePayload();
    const firstId = "kiselev-lesson-1";
    const secondId = "kiselev-lesson-2";
    const parent = {
      ...payload.playlists[0],
      lifecycleStatus: "in-progress",
      lessonCourseIds: [firstId, secondId],
      progress: { completed: 1, total: 3, prepared: 2, partial: 0, ratio: 1 / 3 },
      current: { courseId: secondId, title: "УРОК 2", chapterNumber: 4, chapterTotal: 11, readyChapters: 11 },
    };
    const visible = buildVisibleLibraryItems({
      ...payload,
      courses: payload.courses.filter(({ id }) => [firstId, secondId, "standalone"].includes(id)),
      playlists: [parent],
    });

    expect(parent.progress).toMatchObject({ completed: 1, total: 3 });
    expect(visible.filter(({ kind }) => kind === "youtube-playlist")).toHaveLength(1);
    expect(visible.filter(({ kind }) => kind === "course").map(({ id }) => id)).toEqual(["standalone"]);
    expect(visible.some(({ id }) => id === firstId || id === secondId)).toBe(false);
  });

  it("keeps lesson order and navigation selection inside playlist cards while sorting cards", () => {
    const payload = makePayload();
    const items = buildVisibleLibraryItems(payload);
    const kiselev = items.find(({ id }) => id === "kiselev").value;
    expect(kiselev.lessonCourseIds).toEqual(["kiselev-lesson-1", "kiselev-lesson-2"]);
    expect(kiselev.isLast).toBe(false);
    expect(items.find(({ kind }) => kind === "course").id).toBe("standalone");
  });

  it("escapes playlist titles and displays completed lessons over the full route", () => {
    const card = {
      ...makePayload().playlists[0],
      title: '<script data-injected="true">alert(1)</script>',
      current: { courseId: "lesson-2", title: "УРОК 2: Техническое задание", chapterNumber: 4, chapterTotal: 11, readyChapters: 11 },
    };
    const markup = playlistCardMarkup(card);
    const dom = new JSDOM(markup);

    expect(dom.window.document.querySelector("script[data-injected]")).toBeNull();
    expect(dom.window.document.querySelector("h3").textContent).toBe(card.title);
    expect(dom.window.document.querySelector("[data-playlist-progress]").textContent).toContain("Пройдено уроков: 1 из 4");
    expect(dom.window.document.body.textContent).toContain("Глава 4 из 11");
    expect(dom.window.document.querySelector("[data-action=open-playlist]").dataset.playlistId).toBe("kiselev");
    expect(dom.window.document.querySelector("[data-action=archive-playlist]")).not.toBeNull();
    expect(new JSDOM(playlistCardMarkup(card, { category: "archived" })).window.document
      .querySelector("[data-action=restore-playlist]")).not.toBeNull();
  });
});
