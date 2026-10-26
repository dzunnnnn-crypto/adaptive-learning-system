import { escapeHtml } from "./course-content.js";

const CHOICES = ["А", "Б", "В"];

export function formatVideoTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours > 0
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0")
    : minutes + ":" + String(secs).padStart(2, "0");
}

export function transcriptMarkup(blocks = []) {
  return blocks.map((block) => `<article class="transcript-block" data-transcript-block-id="${escapeHtml(block.id)}">
    <button type="button" class="transcript-time" data-transcript-seek="${Math.max(0, Math.floor(block.startSeconds))}">
      ${formatVideoTime(block.startSeconds)}
    </button>
    <p>${escapeHtml(block.text)}</p>
  </article>`).join("");
}

export function videoQuestionMarkup(question, review) {
  if (!question) return "";
  const choices = CHOICES
    .filter((letter) => question.choices?.[letter])
    .map((letter) => `<button type="button" class="choice-button${review?.choice === letter ? " is-selected" : ""}"
      data-video-choice="${letter}" data-video-question-id="${escapeHtml(question.id)}"${review ? " disabled" : ""}>
      <span class="choice-letter">${letter}</span>
      <span>${escapeHtml(question.choices[letter])}</span>
    </button>`)
    .join("");
  const feedback = review
    ? `<div class="video-question-review" aria-live="polite"><p><strong>${review.correct ? "Верно." : "Не совсем."}</strong> ${escapeHtml((review.explanation ?? "").replace(/^Верно[.:]?\s*/u, ""))}</p></div>`
    : "";
  return `<div class="choice-list" data-video-question-id="${escapeHtml(question.id)}">${choices}</div>${feedback}`;
}

export function videoProgressMarkup(prepared = {}, chapterPreparation = {}) {
  const completed = prepared.completed ?? 0;
  const ready = chapterPreparation.ready ?? 0;
  const total = chapterPreparation.total ?? 0;
  return `<p class="video-segment-meta">Пройдено глав: ${completed} из ${ready}. Подготовлено: ${ready} из ${total}.</p>`;
}
