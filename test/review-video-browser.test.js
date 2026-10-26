import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { bootstrap } from "../public/app.js";

const aiProfiles = {
  selectedProfileId: "codex-terra-medium",
  profiles: [{ id: "codex-terra-medium", label: "Codex · Terra · Medium", available: true }],
};

const videoArtifact = {
  id: "completed-video",
  kind: "video",
  caption: "Фрагмент завершённой главы",
  content: {
    type: "youtube",
    videoId: "ocbtH4-FttI",
    startSeconds: 100,
    endSeconds: 145,
    accessibilityText: "Завершённая глава курса",
  },
};

const secondVideoArtifact = {
  ...videoArtifact,
  id: "completed-video-followup",
  caption: "Продолжение главы",
  content: {
    ...videoArtifact.content,
    videoId: "abcdefghijk",
    startSeconds: 300,
    endSeconds: 330,
  },
};

const lessonView = {
  courseId: "global-video-course",
  courseMode: "video",
  title: "Видеокурс",
  totalUnits: 2,
  progress: 0.5,
  cursor: 1,
  status: "awaiting-video-question",
  lifecycleStatus: "in-progress",
  actualSize: 1,
  completedUnitIds: ["completed-chapter"],
  units: [{
    id: "current-chapter",
    title: "Текущая глава",
    coreText: "Материал текущей главы.",
    artifactRefs: ["current-video"],
  }],
  sectionGroups: [{
    id: "video-chapters",
    title: "Главы видео",
    units: [{
      id: "current-chapter",
      title: "Текущая глава",
      coreText: "Материал текущей главы.",
      artifactRefs: ["current-video"],
    }],
  }],
  sourceArtifacts: [{
    id: "current-video",
    kind: "video",
    caption: "Текущая глава",
    content: { ...videoArtifact.content, startSeconds: 200, endSeconds: 250 },
  }],
  question: { id: "current-question", prompt: "Вопрос?", choices: { "А": "Да", "Б": "Нет", "В": "Не знаю" } },
  questionReview: null,
  videoProgress: null,
  prepared: { completed: 1, total: 2 },
  chapterPreparation: { ready: 2, total: 2 },
};

const courseOutline = {
  courseId: "global-video-course",
  title: "Видеокурс",
  progress: { completed: 1, total: 2 },
  sections: [{
    id: "video-chapters",
    title: "Главы видео",
    order: 1,
    progress: { completed: 1, total: 2 },
    containsCurrent: true,
    units: [
      { id: "completed-chapter", title: "Пройденная глава", order: 1, status: "completed" },
      { id: "current-chapter", title: "Текущая глава", order: 2, status: "current" },
    ],
  }],
};

const review = {
  courseId: "global-video-course",
  courseTitle: "Видеокурс",
  section: { id: "video-chapters", title: "Главы видео" },
  unit: { id: "completed-chapter", title: "Пройденная глава", coreText: "Материал для пересмотра." },
  sourceArtifacts: [videoArtifact, secondVideoArtifact],
};

const playlistOutline = {
  playlistId: "global-video-playlist",
  title: "Видеоплейлист",
  progress: { completed: 1, total: 1 },
  sections: [{
    id: "playlist-section",
    title: "Уроки",
    order: 1,
    lessons: [{
      id: "video-course-route",
      courseId: "global-video-course",
      title: "Видеокурс",
      order: 1,
      status: "current",
      isCurrent: true,
      chapters: [{
        id: "chapter-route-id",
        unitId: "completed-chapter",
        title: "Пройденная глава",
        order: 1,
        status: "completed",
      }],
    }],
  }],
};

function createYouTubeStub() {
  const players = [];
  function Player(element, options) {
    const player = {
      cueVideoById: vi.fn(),
      getCurrentTime: vi.fn(() => 120),
      pauseVideo: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn(),
    };
    players.push({ element, options, player });
    return player;
  }
  return { players, api: { Player, PlayerState: { PAUSED: 2 } } };
}

function response(body) {
  return { ok: true, json: async () => body };
}

async function createBrowser({ playlist = false } = {}) {
  const html = await fs.readFile("public/index.html", "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4173/course/global-video-course",
    pretendToBeVisual: true,
  });
  const root = dom.window.document;
  const youtube = createYouTubeStub();
  dom.window.YT = youtube.api;
  const view = playlist
    ? {
      ...lessonView,
      playlistContext: {
        playlistId: "global-video-playlist",
        playlistTitle: "Видеоплейлист",
        lessonCourseId: "global-video-course",
        lessonTitle: "Видеокурс",
        lessonOrder: 1,
        lessonCompleted: false,
      },
    }
    : lessonView;
  const fetchImpl = vi.fn(async (url, options = {}) => {
    if (url === "/api/ai/profiles") return response(aiProfiles);
    if (url === "/api/courses/global-video-course/session") return response(view);
    if (url === "/api/courses/global-video-course/outline") return response(courseOutline);
    if (url === "/api/playlists/global-video-playlist/outline") return response(playlistOutline);
    if (url === "/api/courses/global-video-course/review/completed-chapter") return response(review);
    if (url === "/api/playlists/global-video-playlist/open" && options.method === "POST") {
      return response({ kind: "outline", outline: playlistOutline });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  await bootstrap({ root, fetchImpl });
  await vi.waitFor(() => expect(youtube.players).toHaveLength(1));
  return { dom, root, fetchImpl, players: youtube.players };
}

async function openCompletedReview(root, { playlist = false } = {}) {
  root.querySelector('[data-action="lesson-outline"]').click();
  const selector = playlist
    ? '[data-outline-action="open-playlist-review"]'
    : '[data-outline-action="open-unit"][data-outline-unit-status="completed"]';
  await vi.waitFor(() => expect(root.querySelector(selector)).not.toBeNull());
  root.querySelector(selector).click();
  await vi.waitFor(() => expect(root.querySelector('[data-screen="review"]').hidden).toBe(false));
}

describe("YouTube playback in completed-unit review", () => {
  it("mounts the chapter player, disposes it on return, and never writes review progress", async () => {
    const { dom, root, fetchImpl, players } = await createBrowser();

    await openCompletedReview(root);
    await vi.waitFor(() => expect(players).toHaveLength(3));

    expect(players[0].player.destroy).toHaveBeenCalledOnce();
    expect(players[1].element.dataset.youtubeVideoId).toBe(videoArtifact.content.videoId);
    expect(players[1].element.dataset.youtubeStart).toBe("100");
    expect(players[2].element.dataset.youtubeVideoId).toBe(secondVideoArtifact.content.videoId);
    expect(players[2].element.dataset.youtubeStart).toBe("300");
    players[1].options.events.onReady({ target: players[1].player });
    expect(players[1].player.cueVideoById).toHaveBeenCalledWith({
      videoId: videoArtifact.content.videoId,
      startSeconds: 100,
      endSeconds: 145,
    });
    players[2].options.events.onReady({ target: players[2].player });
    expect(players[2].player.cueVideoById).toHaveBeenCalledWith({
      videoId: secondVideoArtifact.content.videoId,
      startSeconds: 300,
      endSeconds: 330,
    });
    players[1].options.events.onStateChange({ data: 2, target: players[1].player });
    players[2].options.events.onStateChange({ data: 2, target: players[2].player });

    expect(fetchImpl.mock.calls.some(([url, options = {}]) => (
      url.includes("/video-progress/") && options.method === "PUT"
    ))).toBe(false);

    root.querySelector('[data-outline-action="return-current"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-screen="lesson"]').hidden).toBe(false));
    expect(players[1].player.destroy).toHaveBeenCalledOnce();
    expect(players[2].player.destroy).toHaveBeenCalledOnce();
    dom.window.close();
  });

  it("mounts a completed playlist chapter using its linked course artifact", async () => {
    const { dom, root, fetchImpl, players } = await createBrowser({ playlist: true });

    await openCompletedReview(root, { playlist: true });
    await vi.waitFor(() => expect(players).toHaveLength(3));

    expect(players[0].player.destroy).toHaveBeenCalledOnce();
    expect(players[1].element.dataset.youtubeVideoId).toBe(videoArtifact.content.videoId);
    expect(players[1].element.dataset.youtubeStart).toBe("100");
    expect(players[2].element.dataset.youtubeVideoId).toBe(secondVideoArtifact.content.videoId);
    expect(players[2].element.dataset.youtubeStart).toBe("300");
    players[1].options.events.onStateChange({ data: 2, target: players[1].player });
    players[2].options.events.onStateChange({ data: 2, target: players[2].player });
    expect(fetchImpl.mock.calls.some(([url, options = {}]) => (
      url.includes("/video-progress/") && options.method === "PUT"
    ))).toBe(false);

    root.querySelector('[data-outline-action="return-current"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-screen="review"]').hidden).toBe(true));
    expect(players[1].player.destroy).toHaveBeenCalledOnce();
    expect(players[2].player.destroy).toHaveBeenCalledOnce();
    dom.window.close();
  });
});
