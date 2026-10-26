import { ZodError } from "zod";

const errors = {
  "ai-disabled": {
    status: 503,
    code: "AI_DISABLED",
    message: "ИИ отключён. Видео, вопросы и сохранение прогресса работают без модели.",
  },
  "playlist-not-found": {
    status: 404,
    code: "PLAYLIST_NOT_FOUND",
    message: "Плейлист не найден.",
  },
  "playlist-lesson-forbidden": {
    status: 403,
    code: "PLAYLIST_LESSON_FORBIDDEN",
    message: "Этот урок не входит в выбранный плейлист.",
  },
  "playlist-lesson-not-ready": {
    status: 409,
    code: "PLAYLIST_LESSON_NOT_READY",
    message: "Этот урок ещё не подготовлен.",
  },
  "playlist-navigation-unavailable": {
    status: 503,
    code: "PLAYLIST_NAVIGATION_UNAVAILABLE",
    message: "Навигация плейлиста требует проверки.",
  },
  "playlist-navigation-partial": {
    status: 503,
    code: "PLAYLIST_NAVIGATION_PARTIAL",
    message: "Урок открыт, но точка продолжения не сохранена. Повтори открытие.",
  },
  "course-not-found": {
    status: 404,
    code: "COURSE_NOT_FOUND",
    message: "Курс не найден.",
  },
  "course-unavailable": {
    status: 409,
    code: "COURSE_UNAVAILABLE",
    message: "Курс требует проверки или согласованной миграции.",
  },
  "review-unit-not-found": {
    status: 404,
    code: "UNIT_NOT_FOUND",
    message: "Фрагмент не найден.",
  },
  "review-unit-forbidden": {
    status: 403,
    code: "UNIT_REVIEW_FORBIDDEN",
    message: "Фрагмент пока недоступен для просмотра.",
  },
  "video-question-not-current": {
    status: 409,
    code: "VIDEO_QUESTION_NOT_CURRENT",
    message: "Вопрос недоступен для ответа.",
  },
  "video-question-answered": {
    status: 409,
    code: "VIDEO_QUESTION_ALREADY_ANSWERED",
    message: "Вопрос уже был отвечен.",
  },
  "video-segment-not-found": {
    status: 404,
    code: "VIDEO_SEGMENT_NOT_FOUND",
    message: "Видеоглава не найдена.",
  },
  "video-segment-planned": {
    status: 403,
    code: "VIDEO_SEGMENT_NOT_READY",
    message: "Видеоглава ещё не подготовлена.",
  },
  "asset-not-found": {
    status: 404,
    code: "ASSET_NOT_FOUND",
    message: "Иллюстрация не найдена.",
  },
  "asset-range": {
    status: 416,
    code: "INVALID_ASSET_RANGE",
    message: "Запрошенный диапазон файла недоступен.",
  },
  "invalid-asset-request": {
    status: 400,
    code: "INVALID_ASSET_REQUEST",
    message: "Некорректный запрос иллюстрации.",
  },
  "asset-integrity": {
    status: 409,
    code: "ASSET_INTEGRITY",
    message: "Иллюстрация курса повреждена.",
  },
  "ai-profile-not-found": {
    status: 400,
    code: "INVALID_AI_PROFILE",
    message: "Такого профиля ИИ нет.",
  },
  "zai-key-missing": {
    status: 409,
    code: "ZAI_KEY_MISSING",
    message: "Для GLM добавь ZAI_API_KEY в файл .env.local и перезапусти приложение.",
  },
  "not-installed": {
    status: 503,
    code: "AI_NOT_INSTALLED",
    message: "Codex не найден. Установи или восстанови Codex и повтори запрос.",
  },
  auth: {
    status: 503,
    code: "AI_AUTH",
    message: "Войди в Codex через ChatGPT и повтори запрос.",
  },
  quota: {
    status: 503,
    code: "AI_QUOTA",
    message: "Лимит модели временно исчерпан. Основной урок остаётся доступным.",
  },
  timeout: {
    status: 504,
    code: "AI_TIMEOUT",
    message: "Модель не успела ответить. Можно повторить запрос.",
  },
  unavailable: {
    status: 503,
    code: "AI_UNAVAILABLE",
    message: "Модель временно недоступна. Основной урок остаётся доступным.",
  },
  "invalid-response": {
    status: 502,
    code: "AI_INVALID_RESPONSE",
    message: "Модель вернула неверный формат дважды. Можно повторить запрос позже.",
  },
  "zai-auth": {
    status: 503,
    code: "ZAI_AUTH",
    message: "Z.AI не принял ключ. Проверь ZAI_API_KEY и перезапусти приложение.",
  },
  "zai-quota": {
    status: 503,
    code: "ZAI_QUOTA",
    message: "Лимит GLM временно исчерпан. Выбери другой профиль вручную или повтори позже.",
  },
  "zai-rate-limit": {
    status: 503,
    code: "ZAI_RATE_LIMIT",
    message: "GLM временно ограничил частоту запросов. Подожди и повтори запрос.",
  },
  "zai-fair-use": {
    status: 503,
    code: "ZAI_FAIR_USE",
    message: "Z.AI остановил запрос по Fair Use. Автоматической замены модели не будет.",
  },
  "zai-model-unavailable": {
    status: 503,
    code: "ZAI_MODEL_UNAVAILABLE",
    message: "Выбранная модель GLM сейчас недоступна. Выбери другой профиль вручную.",
  },
  "zai-web-unavailable": {
    status: 503,
    code: "ZAI_WEB_UNAVAILABLE",
    message: "Веб-поиск GLM временно недоступен. Можно выбрать другой профиль вручную.",
  },
  "zai-timeout": {
    status: 504,
    code: "ZAI_TIMEOUT",
    message: "GLM не успел ответить. Можно повторить запрос позже.",
  },
  "zai-invalid-response": {
    status: 502,
    code: "ZAI_INVALID_RESPONSE",
    message: "GLM вернул неверный формат дважды. Можно повторить запрос позже.",
  },
  "zai-unavailable": {
    status: 503,
    code: "ZAI_UNAVAILABLE",
    message: "Z.AI временно недоступен. Основной урок остаётся доступным.",
  },
};

export function errorResponse(error) {
  if (error instanceof ZodError) {
    return { status: 400, code: "INVALID_INPUT", message: "Проверь данные запроса." };
  }
  return errors[error.category] ?? {
    status: 400,
    code: "BAD_REQUEST",
    message: "Действие нельзя выполнить в текущем состоянии урока.",
  };
}
