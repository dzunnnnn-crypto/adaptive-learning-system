import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrap, wireActions } from "../public/app.js";
import { createCourseOutlineController } from "../public/course-outline.js";
import { playlistOutlineMarkup } from "../public/playlist-outline.js";

const outline = {
  playlistId: "bitrix-course",
  title: "Битрикс24: курс",
  progress: { completed: 0, total: 2 },
  sections: [{
    id: "section-one",
    title: "Основы",
    order: 1,
    lessons: [
      {
        id: "lesson-one-route-id",
        courseId: "lesson-one",
        title: "УРОК 1: Основы CRM",
        order: 1,
        status: "current",
        isCurrent: true,
        chapters: [
          { id: "chapter-one", unitId: "learning-unit-real-id", title: "Знакомство", order: 1, status: "completed" },
          { id: "chapter-two", unitId: "active-unit-id", title: "Следующая глава", order: 2, status: "current" },
          { id: "chapter-three", title: "Плановая глава", order: 3, status: "planned" },
        ],
      },
      {
        id: "lesson-two-route-id",
        title: "УРОК 2: <Будущее>",
        order: 2,
        status: "planned",
        chapters: [],
      },
    ],
  }],
};

const review = {
  courseId: "lesson-one",
  courseTitle: "УРОК 1: Основы CRM",
  section: { title: "Основы" },
  unit: { id: "learning-unit-real-id", title: "Знакомство", coreText: "Пройденный текст." },
  sourceArtifacts: [],
};

const lessonView = {
  courseId: "lesson-one",
  courseMode: "video",
  title: "УРОК 1: Основы CRM",
  totalUnits: 1,
  progress: 1,
  cursor: 0,
  status: "video-question-reviewed",
  lifecycleStatus: "in-progress",
  actualSize: 1,
  completedUnitIds: [],
  units: [{ id: "active-unit-id", title: "Последняя глава", coreText: "Текст.", artifactRefs: ["video"] }],
  sectionGroups: [{ id: "video-chapters", title: "Главы", units: [{ id: "active-unit-id", title: "Последняя глава", coreText: "Текст.", artifactRefs: ["video"] }] }],
  sourceArtifacts: [{ id: "video", kind: "video", caption: "Видео", content: { type: "youtube", videoId: "ocbtH4-FttI", startSeconds: 0, endSeconds: 90 } }],
  question: { id: "q1", prompt: "Вопрос?", choices: { "А": "Да", "Б": "Нет", "В": "Не знаю" } },
  questionReview: { questionId: "q1", choice: "А", correct: true, explanation: "Верно." },
  videoProgress: null,
  prepared: { completed: 0, total: 1 },
  playlistContext: {
    playlistId: "bitrix-course",
    playlistTitle: "Битрикс24: курс",
    lessonCourseId: "lesson-one",
    lessonTitle: "УРОК 1: Основы CRM",
    lessonOrder: 1,
    lessonCompleted: false,
  },
};

let document;
let request;
let onOpenPlaylist;
let onShowReview;
let onReturnCurrent;
let controller;

function response(body) {
  return { ok: true, json: async () => body };
}

const aiProfiles = {
  selectedProfileId: "codex-terra-medium",
  profiles: [{ id: "codex-terra-medium", label: "Codex · Terra · Medium", available: true }],
};

beforeEach(async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  document = new JSDOM(html, { url: "http://127.0.0.1:4173/", pretendToBeVisual: true }).window.document;
  request = vi.fn(async (path) => path.includes("/review/") ? structuredClone(review) : structuredClone(outline));
  onOpenPlaylist = vi.fn();
  onShowReview = vi.fn();
  onReturnCurrent = vi.fn();
  controller = createCourseOutlineController({ root: document, request, onOpenPlaylist, onShowReview, onReturnCurrent });
});

describe("playlist course browser", () => {
  it("renders nested lesson chapters and disables future material safely", () => {
    const html = playlistOutlineMarkup(outline, new Set(["lesson-one-route-id"]));

    expect(html).toContain("УРОК 1: Основы CRM");
    expect(html).toContain('data-source-course-id="lesson-one"');
    expect(html).toContain('data-unit-id="learning-unit-real-id"');
    expect(html).toContain('data-outline-chapter-status="planned"');
    expect(html).toContain("disabled");
    expect(html).toContain("&lt;Будущее&gt;");
    expect(html).not.toContain("<Будущее>");
  });

  it("shows a completion notice and opens only a lesson explicitly selected from the outline", async () => {
    await controller.open({ playlistId: "bitrix-course", origin: "catalog", notice: "Урок завершён: УРОК 1: Основы CRM" });

    expect(request).toHaveBeenCalledWith("/api/playlists/bitrix-course/outline");
    expect(document.querySelector('[data-role="playlist-notice"]').textContent).toContain("Урок завершён");
    document.querySelector('[data-outline-action="open-playlist-lesson"][data-course-id="lesson-one"]').click();
    expect(onOpenPlaylist).toHaveBeenCalledWith("bitrix-course", { lessonCourseId: "lesson-one" });
  });

  it("reviews a completed chapter through the child course and its unit ID", async () => {
    await controller.open({ playlistId: "bitrix-course", origin: "catalog" });
    document.querySelector('[data-outline-action="open-playlist-review"]').click();

    await vi.waitFor(() => expect(onShowReview).toHaveBeenCalledOnce());
    expect(request).toHaveBeenNthCalledWith(2, "/api/courses/lesson-one/review/learning-unit-real-id");
    expect(onShowReview).toHaveBeenCalledWith(review, expect.objectContaining({ playlistId: "bitrix-course" }));
  });

  it("returns from review to the parent playlist without selecting the reviewed lesson", async () => {
    await controller.open({ playlistId: "bitrix-course", origin: "catalog" });
    document.querySelector('[data-outline-action="open-playlist-review"]').click();
    await vi.waitFor(() => expect(onShowReview).toHaveBeenCalledOnce());
    document.querySelector('[data-outline-action="return-current"]').click();

    expect(onReturnCurrent).toHaveBeenCalledWith("lesson-one", expect.objectContaining({
      playlistId: "bitrix-course",
      origin: "catalog",
    }));
  });

  it("returns from a reviewed chapter by reopening the saved parent selection without a lesson ID", async () => {
    const root = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/playlist/bitrix-course",
      pretendToBeVisual: true,
    }).window.document;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ kind: "lesson", view: lessonView }))
      .mockResolvedValueOnce(response(outline))
      .mockResolvedValueOnce(response(review))
      .mockResolvedValueOnce(response({ kind: "lesson", view: lessonView }));

    await bootstrap({ root, fetchImpl });
    root.querySelector('[data-action="lesson-outline"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-outline-action="open-playlist-review"]')).not.toBeNull());
    root.querySelector('[data-outline-action="open-playlist-review"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-screen="review"]').hidden).toBe(false));
    root.querySelector('[data-outline-action="return-current"]').click();

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5));
    expect(fetchImpl.mock.calls[4][0]).toBe("/api/playlists/bitrix-course/open");
    expect(fetchImpl.mock.calls[4][1]).toMatchObject({ method: "POST" });
    expect(fetchImpl.mock.calls[4][1]).not.toHaveProperty("body");
    expect(root.defaultView.location.pathname).toBe("/playlist/bitrix-course");
  });

  it("refreshes a completed child URL into the parent outline with a completion notice", async () => {
    const root = new JSDOM(await fs.readFile("public/index.html", "utf8"), {
      url: "http://127.0.0.1:4173/course/lesson-one",
      pretendToBeVisual: true,
    }).window.document;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(aiProfiles))
      .mockResolvedValueOnce(response({ kind: "outline", outline, notice: "Урок завершён: УРОК 1" }))
      .mockResolvedValueOnce(response({ lastCourseId: "lesson-one", courses: [], playlists: [] }))
      .mockResolvedValueOnce(response(outline));

    await bootstrap({ root, fetchImpl });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "/api/ai/profiles",
      "/api/courses/lesson-one/session",
      "/api/courses",
      "/api/playlists/bitrix-course/outline",
    ]);
    expect(root.defaultView.location.pathname).toBe("/playlist/bitrix-course");
    expect(root.querySelector('[data-role="playlist-notice"]').textContent).toContain("Урок завершён");
    expect(root.querySelector('[data-role="playlist-notice"]').textContent).toContain("УРОК 1");
  });

  it("finishes the video at its boundary and opens the playlist outline without another session", async () => {
    const completedView = {
      ...lessonView,
      status: "complete",
      lifecycleStatus: "complete",
      playlistContext: { ...lessonView.playlistContext, lessonCompleted: true },
    };
    const fetchImpl = vi.fn(async (url) => ({ ok: true, json: async () => {
      if (url === "/api/courses/lesson-one/next") return completedView;
      return outline;
    } }));
    let playerOptions;
    const player = { cueVideoById: vi.fn(), getCurrentTime: vi.fn(() => 90), pauseVideo: vi.fn(), seekTo: vi.fn(), destroy: vi.fn() };
    function Player(_element, options) { playerOptions = options; return player; }
    const youtube = {
      Player,
      PlayerState: { PAUSED: 2 },
    };
    const { render } = await import("../public/app.js");
    const onPlaylistBoundary = vi.fn(async ({ view, previousCourseId }) => {
      const response = await fetchImpl("/api/playlists/bitrix-course/outline");
      await controller.open({
        playlistId: view.playlistContext.playlistId,
        origin: "lesson",
        notice: `Урок завершён: ${view.playlistContext.lessonTitle}`,
        outlineData: await response.json(),
      });
      expect(previousCourseId).toBe("lesson-one");
    });
    render(lessonView, document, { fetchImpl, youtube });
    wireActions({
      root: document,
      fetchImpl,
      onPlaylistBoundary,
    });
    await vi.waitFor(() => expect(playerOptions).toBeDefined());
    playerOptions.events.onReady({ target: player });
    document.querySelector('[data-action="next"]').click();

    await vi.waitFor(() => expect(document.querySelector('[data-role="playlist-notice"]').textContent).toContain("УРОК 1"));
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["/api/courses/lesson-one/next", "/api/playlists/bitrix-course/outline"]);
    expect(onPlaylistBoundary).toHaveBeenCalledOnce();
    expect(player.destroy).toHaveBeenCalledOnce();
  });
});
