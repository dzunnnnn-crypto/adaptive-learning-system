import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { render, wireActions } from "../public/app.js";

const videoView = {
  courseId: "video-course",
  courseMode: "video",
  title: "Видеокурс",
  totalUnits: 1,
  progress: 0,
  cursor: 0,
  status: "awaiting-video-question",
  lifecycleStatus: "new",
  actualSize: 1,
  completedUnitIds: [],
  units: [{
    id: "introduction",
    title: "Introduction",
    coreText: "Очищенная расшифровка первой главы.",
    artifactRefs: ["video-introduction"],
  }],
  sectionGroups: [{
    id: "video-chapters",
    title: "Главы видео",
    units: [{
      id: "introduction",
      title: "Introduction",
      coreText: "Очищенная расшифровка первой главы.",
      artifactRefs: ["video-introduction"],
    }],
  }],
  sourceArtifacts: [{
    id: "video-introduction",
    kind: "video",
    caption: "Первая глава",
    content: {
      type: "youtube",
      videoId: "ocbtH4-FttI",
      startSeconds: 0,
      endSeconds: 353,
      accessibilityText: "Введение",
    },
  }],
  transcript: {
    language: "ru",
    kind: "cleaned",
    blocks: [{
      id: "opening",
      startSeconds: 28,
      endSeconds: 94,
      text: "Первый очищенный смысловой абзац выбранной главы.",
    }],
  },
  question: {
    id: "introduction-question-1",
    prompt: "Что обозначает первая глава?",
    choices: { "А": "Введение", "Б": "Настройку IDE", "В": "Публикацию курса" },
  },
  questionReview: null,
  videoProgress: null,
  prepared: { completed: 0, total: 1 },
  chapterPreparation: { ready: 1, total: 2 },
};

describe("video course browser renderer", () => {
  it("keeps the current player mounted while showing an answer explanation", async () => {
    const document = new JSDOM(await fs.readFile("public/index.html", "utf8")).window.document;
    const player = { destroy: vi.fn(), cueVideoById: vi.fn() };
    const construct = vi.fn();
    function Player() { construct(); return player; }
    const runtime = { fetchImpl: vi.fn(), youtube: { Player } };
    render(videoView, document, runtime);
    await vi.waitFor(() => expect(construct).toHaveBeenCalledOnce());
    const element = document.querySelector("[data-youtube-player]");
    render({ ...videoView, status: "video-question-reviewed", questionReview: {
      choice: "А", correct: true, explanation: "Верно. Ответ проверен по материалу.",
    } }, document, runtime);
    expect(document.querySelector("[data-youtube-player]")).toBe(element);
    expect(construct).toHaveBeenCalledOnce();
    expect(player.destroy).not.toHaveBeenCalled();
    expect(document.querySelector(".video-question-review").textContent).not.toContain("Верно. Верно.");
    render({ ...videoView, courseMode: "article" }, document);
    expect(player.destroy).toHaveBeenCalledOnce();
  });
  it("renders the video and one safe question without transcript text", async () => {
    const html = await fs.readFile("public/index.html", "utf8");
    const document = new JSDOM(html).window.document;
    render(videoView, document);

    expect(document.querySelectorAll("[data-youtube-player]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-transcript-seek]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-video-choice]")).toHaveLength(3);
    expect(document.body.textContent).not.toContain(videoView.units[0].coreText);
    expect(document.body.textContent).not.toContain(videoView.transcript.blocks[0].text);
    expect(document.body.textContent).not.toContain("Разбор варианта");
    expect(document.querySelector("[data-role=lesson-size]").hidden).toBe(true);
    expect(document.querySelector("[data-role=application]").hidden).toBe(true);
  });

  it("submits the selected identified video question", async () => {
    const html = await fs.readFile("public/index.html", "utf8");
    const document = new JSDOM(html).window.document;
    const reviewedView = {
      ...videoView,
      status: "video-question-reviewed",
      questionReview: {
        questionId: "introduction-question-1",
        choice: "А",
        correct: true,
        explanation: "Верный разбор.",
      },
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => reviewedView }));
    render(videoView, document);
    wireActions({ root: document, fetchImpl });

    document.querySelector('[data-video-choice="А"]').click();

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/courses/video-course/questions/introduction-question-1/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ choice: "А" }),
      }),
    );
  });

  it("connects the YouTube controller, saves pause position, and exposes fallback", async () => {
    let options;
    let seconds = 100;
    const player = {
      cueVideoById: vi.fn(),
      getCurrentTime: vi.fn(() => seconds),
      pauseVideo: vi.fn(),
      seekTo: vi.fn((value) => { seconds = value; }),
      destroy: vi.fn(),
    };
    function Player(_element, nextOptions) {
      options = nextOptions;
      return player;
    }
    const youtube = {
      Player,
      PlayerState: { PAUSED: 2 },
    };
    const html = await fs.readFile("public/index.html", "utf8");
    const document = new JSDOM(html, { pretendToBeVisual: true }).window.document;
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => videoView }));

    render(videoView, document, { fetchImpl, youtube });
    await vi.waitFor(() => expect(options).toBeDefined());
    options.events.onReady({ target: player });
    options.events.onStateChange({ data: youtube.PlayerState.PAUSED, target: player });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/courses/video-course/video-progress/introduction",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ positionSeconds: 100 }),
        keepalive: true,
      }),
    );

    options.events.onError({ data: 150, target: player });
    expect(document.querySelector("[data-youtube-fallback]").hidden).toBe(false);
    render({ ...videoView, courseMode: "article" }, document);
    expect(player.destroy).toHaveBeenCalled();
  });
});
