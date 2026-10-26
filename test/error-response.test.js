import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/http/error-response.js";

describe("course error responses", () => {
  it("returns a safe not-found response", () => {
    expect(errorResponse({ category: "course-not-found", message: "C:\\private\\file" })).toEqual({
      status: 404,
      code: "COURSE_NOT_FOUND",
      message: "Курс не найден.",
    });
  });

  it("returns a safe unavailable response without parser details", () => {
    expect(errorResponse({ category: "course-unavailable", message: "Unexpected token at C:\\secret" })).toEqual({
      status: 409,
      code: "COURSE_UNAVAILABLE",
      message: "Курс требует проверки или согласованной миграции.",
    });
  });

  it("maps course asset errors without exposing filesystem details", () => {
    expect(errorResponse({ category: "asset-not-found", message: "C:\\private\\missing.png" }))
      .toEqual({ status: 404, code: "ASSET_NOT_FOUND", message: "Иллюстрация не найдена." });
    expect(errorResponse({ category: "invalid-asset-request", message: "../learning_memory.md" }))
      .toEqual({ status: 400, code: "INVALID_ASSET_REQUEST", message: "Некорректный запрос иллюстрации." });
    expect(errorResponse({ category: "asset-integrity", message: "wrong sha256" }))
      .toEqual({ status: 409, code: "ASSET_INTEGRITY", message: "Иллюстрация курса повреждена." });
  });

  it("maps review errors without exposing unit content", () => {
    expect(errorResponse({
      category: "review-unit-not-found",
      message: "private title",
    })).toEqual({
      status: 404,
      code: "UNIT_NOT_FOUND",
      message: "Фрагмент не найден.",
    });
    expect(errorResponse({
      category: "review-unit-forbidden",
      message: "correct answer details",
    })).toEqual({
      status: 403,
      code: "UNIT_REVIEW_FORBIDDEN",
      message: "Фрагмент пока недоступен для просмотра.",
    });
  });

  it("maps playlist failures to fixed Russian responses without internal details", () => {
    expect(errorResponse({ category: "playlist-not-found", message: "C:\\private\\roadmaps.json" }))
      .toEqual({ status: 404, code: "PLAYLIST_NOT_FOUND", message: "Плейлист не найден." });
    expect(errorResponse({ category: "playlist-lesson-forbidden", message: "private course ID" }))
      .toEqual({ status: 403, code: "PLAYLIST_LESSON_FORBIDDEN", message: "Этот урок не входит в выбранный плейлист." });
    expect(errorResponse({ category: "playlist-lesson-not-ready", message: "private subtitle path" }))
      .toEqual({ status: 409, code: "PLAYLIST_LESSON_NOT_READY", message: "Этот урок ещё не подготовлен." });
    expect(errorResponse({ category: "playlist-navigation-unavailable", message: "C:\\private\\state.json" }))
      .toEqual({ status: 503, code: "PLAYLIST_NAVIGATION_UNAVAILABLE", message: "Навигация плейлиста требует проверки." });
    expect(errorResponse({ category: "playlist-navigation-partial", message: "raw parser error" }))
      .toEqual({ status: 503, code: "PLAYLIST_NAVIGATION_PARTIAL", message: "Урок открыт, но точка продолжения не сохранена. Повтори открытие." });
  });

  it("maps video errors without exposing question or source details", () => {
    expect(errorResponse({ category: "video-question-not-current", message: "introduction-question-2" }))
      .toEqual({ status: 409, code: "VIDEO_QUESTION_NOT_CURRENT", message: "Вопрос недоступен для ответа." });
    expect(errorResponse({ category: "video-question-answered", message: "correct answer A" }))
      .toEqual({ status: 409, code: "VIDEO_QUESTION_ALREADY_ANSWERED", message: "Вопрос уже был отвечен." });
    expect(errorResponse({ category: "video-segment-not-found", message: "C:\\private\\segment" }))
      .toEqual({ status: 404, code: "VIDEO_SEGMENT_NOT_FOUND", message: "Видеоглава не найдена." });
    expect(errorResponse({ category: "video-segment-planned", message: "future chapter" }))
      .toEqual({ status: 403, code: "VIDEO_SEGMENT_NOT_READY", message: "Видеоглава ещё не подготовлена." });
  });

  it("maps Z.AI errors without raw provider details", () => {
    expect(errorResponse({ category: "zai-auth", message: "Bearer test-key is rejected" })).toEqual({
      status: 503,
      code: "ZAI_AUTH",
      message: "Z.AI не принял ключ. Проверь ZAI_API_KEY и перезапусти приложение.",
    });
    expect(errorResponse({ category: "zai-fair-use", message: "1313 internal detail" })).toEqual({
      status: 503,
      code: "ZAI_FAIR_USE",
      message: "Z.AI остановил запрос по Fair Use. Автоматической замены модели не будет.",
    });
    expect(errorResponse({ category: "zai-web-unavailable", message: "MCP URL with key" })).toEqual({
      status: 503,
      code: "ZAI_WEB_UNAVAILABLE",
      message: "Веб-поиск GLM временно недоступен. Можно выбрать другой профиль вручную.",
    });
  });
});
