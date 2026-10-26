import { escapeHtml } from "./course-content.js";

const LESSON_STATUS = {
  current: { symbol: "●", label: "Текущий урок" },
  prepared: { symbol: "○", label: "Подготовлен" },
  partial: { symbol: "◐", label: "Подготовлен частично" },
  completed: { symbol: "✓", label: "Пройден" },
  "waiting-content": { symbol: "◷", label: "Продолжение готовится" },
  planned: { symbol: "○", label: "Ещё не подготовлен" },
  unavailable: { symbol: "!", label: "Требует проверки" },
};

const CHAPTER_STATUS = {
  completed: { symbol: "✓", label: "Пройдено" },
  current: { symbol: "●", label: "Текущая глава" },
  locked: { symbol: "🔒", label: "Пока закрыто" },
  planned: { symbol: "○", label: "Ещё не подготовлено" },
};

function lessonMarkup(lesson, expanded) {
  const state = LESSON_STATUS[lesson.status] ?? LESSON_STATUS.unavailable;
  const canOpen = Boolean(lesson.courseId)
    && ["current", "prepared", "partial"].includes(lesson.status);
  const openButton = `<button type="button" class="playlist-lesson-open" data-outline-action="open-playlist-lesson" data-lesson-id="${escapeHtml(lesson.id)}" data-course-id="${escapeHtml(lesson.courseId ?? "")}" data-playlist-lesson-status="${escapeHtml(lesson.status)}"${canOpen ? "" : " disabled"}>
    <span class="outline-unit-mark" aria-hidden="true">${state.symbol}</span>
    <span class="playlist-lesson-title">${escapeHtml(lesson.title)}</span>
    <span class="playlist-lesson-status">${escapeHtml(state.label)}</span>
  </button>`;
  const chapters = `<div class="playlist-chapters" data-playlist-lesson-body="${escapeHtml(lesson.id)}"${expanded ? "" : " hidden"}>
    ${lesson.chapters.map((chapter) => chapterMarkup(chapter, lesson.courseId)).join("")}
  </div>`;
  return `<article class="playlist-lesson is-${escapeHtml(lesson.status)}" data-playlist-lesson="${escapeHtml(lesson.id)}">
    <div class="playlist-lesson-row">
      <button type="button" class="playlist-lesson-toggle" data-outline-action="toggle-playlist-lesson" data-lesson-id="${escapeHtml(lesson.id)}" aria-expanded="${expanded}" aria-label="${expanded ? "Свернуть" : "Показать главы урока"} ${escapeHtml(lesson.title)}" aria-controls="playlist-lesson-${escapeHtml(lesson.id)}"><span aria-hidden="true">${expanded ? "⌄" : "›"}</span></button>
      ${openButton}
    </div>
    <div id="playlist-lesson-${escapeHtml(lesson.id)}">${chapters}</div>
  </article>`;
}

function chapterMarkup(chapter, courseId) {
  const state = CHAPTER_STATUS[chapter.status] ?? CHAPTER_STATUS.locked;
  const canReview = chapter.status === "completed" && courseId && chapter.unitId;
  return `<button type="button" class="playlist-chapter is-${escapeHtml(chapter.status)}" data-outline-action="open-playlist-review" data-source-course-id="${escapeHtml(courseId ?? "")}" data-unit-id="${escapeHtml(chapter.unitId ?? "")}" data-outline-chapter-status="${escapeHtml(chapter.status)}"${canReview ? "" : " disabled"}>
    <span class="outline-unit-mark" aria-hidden="true">${state.symbol}</span>
    <span class="outline-unit-title">${escapeHtml(chapter.title)}</span>
    <span class="sr-only">${escapeHtml(state.label)}</span>
  </button>`;
}

function sectionMarkup(section, expandedLessonIds) {
  const expanded = expandedLessonIds.has(`section:${section.id}`);
  const panelId = `playlist-section-${escapeHtml(section.id)}`;
  const completed = section.lessons.filter(({ status }) => status === "completed").length;
  return `<section class="outline-section playlist-outline-section" data-playlist-section="${escapeHtml(section.id)}">
    <button type="button" class="outline-section-toggle" data-outline-action="toggle-playlist-section" data-playlist-section-id="${escapeHtml(section.id)}" aria-expanded="${expanded}" aria-controls="${panelId}">
      <span>${escapeHtml(section.title)}</span>
      <span>${completed} из ${section.lessons.length}</span>
    </button>
    <div id="${panelId}" data-playlist-section-body${expanded ? "" : " hidden"}>
      ${section.lessons.map((lesson) => lessonMarkup(lesson, expandedLessonIds.has(lesson.id))).join("")}
    </div>
  </section>`;
}

export function playlistOutlineMarkup(outline, expandedLessonIds = new Set()) {
  const progress = outline.progress ?? { completed: 0, total: 0 };
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  return `<div class="outline-summary" data-role="playlist-progress">
    <span>Пройдено уроков: ${progress.completed} из ${progress.total}</span>
    <span class="outline-progress-track" role="progressbar" aria-label="Прогресс плейлиста" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.completed}"><span style="width: ${percent}%"></span></span>
  </div>
  ${outline.navigationError ? `<p class="playlist-outline-warning" role="status">${escapeHtml(outline.navigationError)}</p>` : ""}
  ${(outline.sections ?? []).map((section) => sectionMarkup(section, expandedLessonIds)).join("")}`;
}
