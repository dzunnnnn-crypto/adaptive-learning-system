import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import { createApp } from "../src/http/create-app.js";
import { API_VERSION } from "../src/app-identity.js";

let app;
let service;
let manager;
let aiProfileService;
let assetDirectory;

beforeEach(async () => {
  assetDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "http-assets-"));
  service = {
    getView: vi.fn().mockResolvedValue({ units: [{ id: "bp-03" }] }),
    resize: vi.fn(),
    answer: vi.fn(),
    skipQuestions: vi.fn(),
    setReadingMode: vi.fn(),
    answerVideoQuestion: vi.fn(),
    updateVideoProgress: vi.fn(),
    chooseApplication: vi.fn(),
    next: vi.fn(),
    generateLayer: vi.fn(),
    startPractice: vi.fn(),
    reviewPractice: vi.fn(),
    askClarification: vi.fn(),
    completeActivity: vi.fn(),
  };
 manager = {
   listCourses: vi.fn().mockResolvedValue([{ id: "build-skills", availability: "available" }]),
   listPlaylists: vi.fn().mockResolvedValue([{ id: "playlist-a", title: "Плейлист" }]),
   getLastCourseId: vi.fn().mockResolvedValue("build-skills"),
   open: vi.fn().mockResolvedValue({ courseId: "build-skills", units: [{ id: "bp-03" }] }),
    openPlaylist: vi.fn().mockResolvedValue({ kind: "lesson", view: { courseId: "build-skills" } }),
    playlistOutlineFor: vi.fn().mockResolvedValue({ appId: "adaptive-codex-learning", apiVersion: API_VERSION, playlistId: "playlist-a", sections: [] }),
    archivePlaylist: vi.fn().mockResolvedValue({ id: "playlist-a", archived: true }),
    restorePlaylist: vi.fn().mockResolvedValue({ id: "playlist-a", archived: false }),
    decorateView: vi.fn(async (_courseId, view) => view),
    archiveCourse: vi.fn().mockResolvedValue([{ id: "build-skills", archived: false }, { id: "js-fetch", archived: true }]),
    restoreCourse: vi.fn().mockResolvedValue([{ id: "build-skills", archived: false }, { id: "js-fetch", archived: false }]),
   outlineFor: vi.fn().mockResolvedValue({
      appId: "adaptive-codex-learning",
      apiVersion: API_VERSION,
      courseId: "build-skills",
      title: "Build skills",
      progress: { completed: 1, total: 2 },
      sections: [],
    }),
    reviewFor: vi.fn().mockResolvedValue({
      appId: "adaptive-codex-learning",
      apiVersion: API_VERSION,
      courseId: "build-skills",
      unit: { id: "done-unit", title: "Пройдено", coreText: "Текст" },
      sourceArtifacts: [],
    }),
    serviceFor: vi.fn().mockResolvedValue(service),
    assetFor: vi.fn(),
  };
  aiProfileService = {
    getPublicState: vi.fn().mockResolvedValue({
      selectedProfileId: "codex-terra-medium",
      profiles: [{
        id: "codex-terra-medium",
        label: "Codex · Terra · Medium",
        provider: "codex",
        available: true,
        unavailableReason: null,
      }],
    }),
    select: vi.fn().mockResolvedValue({
      selectedProfileId: "codex-sol-xhigh",
      profiles: [],
    }),
  };
  app = createApp({ manager, publicPath: path.resolve("public"), aiProfileService });
});

afterEach(async () => {
  await fs.rm(assetDirectory, { recursive: true, force: true });
});

describe("learning HTTP API", () => {
  it("reports the application identity without opening a course", async () => {
    await request(app).get("/api/health").expect(200, {
      appId: "adaptive-codex-learning",
      apiVersion: API_VERSION,
    });
    expect(manager.open).not.toHaveBeenCalled();
  });

  it("returns the catalog and the last course pointer", async () => {
    await request(app).get("/api/courses").expect(200, {
      lastCourseId: "build-skills",
      courses: [{ id: "build-skills", availability: "available" }],
      playlists: [{ id: "playlist-a", title: "Плейлист" }],
    });
  });

  it("reads a playlist outline without opening a lesson", async () => {
    await request(app).get("/api/playlists/playlist-a/outline").expect(200, {
      appId: "adaptive-codex-learning",
      apiVersion: API_VERSION,
      playlistId: "playlist-a",
      sections: [],
    });
    expect(manager.playlistOutlineFor).toHaveBeenCalledWith("playlist-a");
    expect(manager.openPlaylist).not.toHaveBeenCalled();
  });

  it("opens a selected playlist lesson and returns an explicit outline result when no lesson is chosen", async () => {
    await request(app).post("/api/playlists/playlist-a/open")
      .send({ lessonCourseId: "build-skills" })
      .expect(200, { kind: "lesson", view: { courseId: "build-skills" } });
    expect(manager.openPlaylist).toHaveBeenCalledWith("playlist-a", { lessonCourseId: "build-skills" });

    manager.openPlaylist.mockResolvedValueOnce({ kind: "outline", outline: { playlistId: "playlist-a" }, notice: null });
    await request(app).post("/api/playlists/playlist-a/open").send({})
      .expect(200, { kind: "outline", outline: { playlistId: "playlist-a" }, notice: null });
    expect(manager.openPlaylist).toHaveBeenLastCalledWith("playlist-a", {});
  });

  it("rejects malformed playlist IDs and unexpected open fields before manager writes", async () => {
    await request(app).get("/api/playlists/BAD__ID/outline")
      .expect(400, { code: "INVALID_INPUT", message: "Проверь данные запроса." });
    await request(app).post("/api/playlists/playlist-a/open")
      .send({ lessonCourseId: "build-skills", extra: true })
      .expect(400, { code: "INVALID_INPUT", message: "Проверь данные запроса." });
    expect(manager.playlistOutlineFor).not.toHaveBeenCalled();
    expect(manager.openPlaylist).not.toHaveBeenCalled();
  });

  it("archives and restores the playlist card through parent actions", async () => {
    await request(app).post("/api/playlists/playlist-a/archive")
      .expect(200, { playlists: [{ id: "playlist-a", title: "Плейлист" }] });
    expect(manager.archivePlaylist).toHaveBeenCalledWith("playlist-a");
    await request(app).post("/api/playlists/playlist-a/restore")
      .expect(200, { playlists: [{ id: "playlist-a", title: "Плейлист" }] });
    expect(manager.restorePlaylist).toHaveBeenCalledWith("playlist-a");
  });

  it("adds playlist context to active learning responses", async () => {
    service.answer.mockResolvedValue({ courseId: "build-skills", status: "reviewed" });
    manager.decorateView.mockImplementation(async (courseId, view) => ({
      ...view,
      playlistContext: { playlistId: "playlist-a", lessonCourseId: courseId },
    }));
    await request(app).post("/api/courses/build-skills/answer").send({ choice: "А" }).expect(200, {
      courseId: "build-skills",
      status: "reviewed",
      playlistContext: { playlistId: "playlist-a", lessonCourseId: "build-skills" },
    });
  });

  it("archives a course and returns the updated catalog", async () => {
    const response = await request(app)
      .post("/api/courses/js-fetch/archive")
      .expect(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.find((c) => c.id === "js-fetch").archived).toBe(true);
    expect(manager.archiveCourse).toHaveBeenCalledWith("js-fetch");
  });

  it("restores an archived course and returns the updated catalog", async () => {
    const response = await request(app)
      .post("/api/courses/js-fetch/restore")
      .expect(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.find((c) => c.id === "js-fetch").archived).toBe(false);
    expect(manager.restoreCourse).toHaveBeenCalledWith("js-fetch");
  });

  it("returns the safe profile catalog without opening a course", async () => {
    await request(app).get("/api/ai/profiles").expect(200, {
      selectedProfileId: "codex-terra-medium",
      profiles: [{
        id: "codex-terra-medium",
        label: "Codex · Terra · Medium",
        provider: "codex",
        available: true,
        unavailableReason: null,
      }],
    });
    expect(aiProfileService.getPublicState).toHaveBeenCalledOnce();
    expect(manager.open).not.toHaveBeenCalled();
  });

  it("selects one strict profile ID", async () => {
    await request(app)
      .put("/api/ai/profile")
      .send({ profileId: "codex-sol-xhigh" })
      .expect(200, { selectedProfileId: "codex-sol-xhigh", profiles: [] });

    expect(aiProfileService.select).toHaveBeenCalledWith("codex-sol-xhigh");
  });

  it("rejects malformed profile selection before calling the service", async () => {
    await request(app)
      .put("/api/ai/profile")
      .send({ profileId: "codex-sol-xhigh", model: "custom" })
      .expect(400, { code: "INVALID_INPUT", message: "Проверь данные запроса." });

    expect(aiProfileService.select).not.toHaveBeenCalled();
  });

  it("maps unknown and unavailable profile choices to safe errors", async () => {
    aiProfileService.select.mockRejectedValueOnce(
      Object.assign(new Error("unknown provider configuration"), { category: "ai-profile-not-found" }),
    );
    await request(app)
      .put("/api/ai/profile")
      .send({ profileId: "custom-model" })
      .expect(400, { code: "INVALID_AI_PROFILE", message: "Такого профиля ИИ нет." });

    aiProfileService.select.mockRejectedValueOnce(
      Object.assign(new Error("key missing"), { category: "zai-key-missing" }),
    );
    await request(app)
      .put("/api/ai/profile")
      .send({ profileId: "zai-glm-5-2-max" })
      .expect(409, {
        code: "ZAI_KEY_MISSING",
        message: "Для GLM добавь ZAI_API_KEY в файл .env.local и перезапусти приложение.",
      });
  });

  it("opens one course-scoped session", async () => {
    const response = await request(app).get("/api/courses/build-skills/session").expect(200);
    expect(response.body.units[0].id).toBe("bp-03");
    expect(manager.open).toHaveBeenCalledWith("build-skills");
  });

  it("returns a read-only safe course outline", async () => {
    const response = await request(app)
      .get("/api/courses/build-skills/outline")
      .expect(200);
    expect(response.body.progress).toEqual({ completed: 1, total: 2 });
    expect(manager.outlineFor).toHaveBeenCalledWith("build-skills");
    expect(manager.open).not.toHaveBeenCalled();
  });

  it("returns one completed unit through the review route", async () => {
    const response = await request(app)
      .get("/api/courses/build-skills/review/done-unit")
      .expect(200);
    expect(response.body.unit).toEqual({
      id: "done-unit",
      title: "Пройдено",
      coreText: "Текст",
    });
    expect(manager.reviewFor).toHaveBeenCalledWith("build-skills", "done-unit");
  });

  it("maps denied review to a neutral 403", async () => {
    manager.reviewFor.mockRejectedValue(
      Object.assign(new Error("private unit details"), {
        category: "review-unit-forbidden",
      }),
    );
    await request(app)
      .get("/api/courses/build-skills/review/future-unit")
      .expect(403, {
        code: "UNIT_REVIEW_FORBIDDEN",
        message: "Фрагмент пока недоступен для просмотра.",
      });
  });

  it("validates resize delta", async () => {
    await request(app).post("/api/courses/build-skills/resize").send({ delta: 2 }).expect(400);
    expect(service.resize).not.toHaveBeenCalled();
  });

  it("skips the remaining block questions through the service", async () => {
    service.skipQuestions.mockResolvedValue({
      status: "reviewed",
      skipNotice: "Вопросы блока пропущены",
    });
    const response = await request(app)
      .post("/api/courses/build-skills/skip-questions")
      .expect(200);
    expect(response.body).toEqual({
      status: "reviewed",
      skipNotice: "Вопросы блока пропущены",
    });
    expect(service.skipQuestions).toHaveBeenCalledTimes(1);
  });

  it("toggles the per-course reading mode and validates the payload", async () => {
    service.setReadingMode.mockResolvedValue({ status: "reviewed", readingMode: true });
    await request(app)
      .put("/api/courses/build-skills/reading-mode")
      .send({ enabled: true })
      .expect(200)
      .expect({ status: "reviewed", readingMode: true });
    expect(service.setReadingMode).toHaveBeenCalledWith(true);
    await request(app)
      .put("/api/courses/build-skills/reading-mode")
      .send({ enabled: "yes" })
      .expect(400);
    expect(service.setReadingMode).toHaveBeenCalledTimes(1);
  });

  it("records one prepared application choice", async () => {
    service.chooseApplication.mockResolvedValue({ status: "complete", applicationChoice: "В" });
    const response = await request(app)
      .post("/api/courses/build-skills/application")
      .send({ choice: "В" })
      .expect(200);
    expect(response.body).toMatchObject({ status: "complete", applicationChoice: "В" });
  });

  it("answers one identified video question", async () => {
    service.answerVideoQuestion.mockResolvedValue({
      questionReview: { questionId: "introduction-question-1", correct: true },
    });
    await request(app)
      .post("/api/courses/video/questions/introduction-question-1/answer")
      .send({ choice: "Б" })
      .expect(200);
    expect(service.answerVideoQuestion)
      .toHaveBeenCalledWith("introduction-question-1", "Б");
  });

  it("saves one integer video position", async () => {
    service.updateVideoProgress.mockResolvedValue({
      videoProgress: { positionSeconds: 197, watched: false },
    });
    await request(app)
      .put("/api/courses/video/video-progress/introduction")
      .send({ positionSeconds: 197 })
      .expect(200);
    expect(service.updateVideoProgress).toHaveBeenCalledWith("introduction", 197);
  });

  it.each([-1, 1.5, "197", null])("rejects invalid position %s", async (value) => {
    await request(app)
      .put("/api/courses/video/video-progress/introduction")
      .send({ positionSeconds: value })
      .expect(400);
    expect(service.updateVideoProgress).not.toHaveBeenCalled();
  });

  it("maps quota failures without exposing internal text", async () => {
    service.generateLayer.mockRejectedValue(
      Object.assign(new Error("provider secret"), { category: "quota" }),
    );
    const response = await request(app).post("/api/courses/build-skills/ai/detail").send({}).expect(503);
    expect(response.body).toEqual({
      code: "AI_QUOTA",
      message: "Лимит модели временно исчерпан. Основной урок остаётся доступным.",
    });
  });

  it("submits one trimmed clarification question", async () => {
    service.askClarification.mockResolvedValue({
      clarificationThread: { messages: [{ role: "assistant", text: "Ответ" }] },
    });
    await request(app)
      .post("/api/courses/build-skills/clarification")
      .send({ question: "  Почему?  " })
      .expect(200);
    expect(service.askClarification).toHaveBeenCalledWith("Почему?");
  });

  it("rejects an empty clarification question", async () => {
    await request(app)
      .post("/api/courses/build-skills/clarification")
      .send({ question: "   " })
      .expect(400);
    expect(service.askClarification).not.toHaveBeenCalled();
  });

  it("records a prepared activity in the selected course only", async () => {
    service.completeActivity.mockResolvedValue({ activities: [{ unitId: "chapter-four-response-ok", completed: true }] });

    await request(app)
      .post("/api/courses/js-fetch/activity")
      .send({ unitId: "chapter-four-response-ok", result: "Проверка выполнена." })
      .expect(200);

    expect(manager.serviceFor).toHaveBeenCalledWith("js-fetch");
    expect(service.completeActivity).toHaveBeenCalledWith("chapter-four-response-ok", "Проверка выполнена.");
  });

  it("serves the application shell for a direct course URL", async () => {
    const response = await request(app).get("/course/build-skills").expect(200);
    expect(response.text).toContain("<!doctype html>");
  });

  it("serves the application shell for a direct playlist URL", async () => {
    const response = await request(app).get("/playlist/playlist-a").expect(200);
    expect(response.text).toContain("<!doctype html>");
  });

  it("serves one verified declared course image with safe headers", async () => {
    const sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const imagePath = path.join(assetDirectory, "foundation-map.png");
    await fs.writeFile(imagePath, Buffer.from("png-bytes"));
    manager.assetFor.mockResolvedValue({
      filePath: imagePath,
      contentType: "image/png",
      presentation: "image",
      originalName: "foundation-map.png",
      sizeBytes: 9,
      sha256,
    });

    const response = await request(app)
      .get("/api/courses/sample-article/assets/foundation-map.png")
      .expect(200)
      .expect("Content-Type", /image\/png/)
      .expect("X-Content-Type-Options", "nosniff")
      .expect("Cache-Control", "private, max-age=31536000, immutable")
      .expect("ETag", `"${sha256}"`);

    expect(response.body).toEqual(Buffer.from("png-bytes"));
    expect(manager.assetFor).toHaveBeenCalledWith("sample-article", "foundation-map.png");
  });

  it("serves a byte range from a verified media descriptor", async () => {
    const filePath = path.join(assetDirectory, "demo.webm");
    await fs.writeFile(filePath, Buffer.from("0123456789"));
    manager.assetFor.mockResolvedValue({
      filePath,
      contentType: "video/webm",
      presentation: "video",
      originalName: "Demo.webm",
      sizeBytes: 10,
      sha256: "a".repeat(64),
    });

    const response = await request(app)
      .get("/api/courses/sample-article/assets/demo.webm")
      .set("Range", "bytes=2-5")
      .expect(206)
      .expect("Content-Range", "bytes 2-5/10")
      .expect("Accept-Ranges", "bytes")
      .expect("Content-Length", "4");

    expect(response.body).toEqual(Buffer.from("2345"));
  });

  it("returns 416 for an unavailable byte range", async () => {
    manager.assetFor.mockResolvedValue({
      filePath: path.join(assetDirectory, "demo.webm"),
      contentType: "video/webm",
      presentation: "video",
      originalName: "Demo.webm",
      sizeBytes: 10,
      sha256: "a".repeat(64),
    });

    await request(app)
      .get("/api/courses/sample-article/assets/demo.webm")
      .set("Range", "bytes=10-20")
      .expect(416)
      .expect("Content-Range", "bytes */10");
  });

  it("forces unknown files to download as octet-stream", async () => {
    const filePath = path.join(assetDirectory, "examples.zip");
    await fs.writeFile(filePath, Buffer.from("zip"));
    manager.assetFor.mockResolvedValue({
      filePath,
      contentType: "application/octet-stream",
      presentation: "download",
      originalName: "Examples.zip",
      sizeBytes: 3,
      sha256: "a".repeat(64),
    });

    await request(app)
      .get("/api/courses/sample-article/assets/examples.zip")
      .expect(200)
      .expect("Content-Type", /application\/octet-stream/)
      .expect("Content-Disposition", /attachment/);
  });

  it("maps an undeclared course image to the standard not-found response", async () => {
    manager.assetFor.mockRejectedValue(
      Object.assign(new Error("C:\\private\\asset.png"), { category: "asset-not-found" }),
    );

    await request(app)
      .get("/api/courses/sample-article/assets/private.png")
      .expect(404, { code: "ASSET_NOT_FOUND", message: "Иллюстрация не найдена." });
  });

});
