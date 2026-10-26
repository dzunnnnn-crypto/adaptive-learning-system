import { initThemeControl } from "./theme.js";
import {
  courseIdFromPath,
  coursePath,
  renderCatalog,
  renderInlineOutline,
  rerenderInlineOutline,
  toggleCourseSort,
} from "./course-library.js";
import {
  escapeHtml,
  sectionGroupsMarkup,
  wireArtifactFallbacks,
} from "./course-content.js";
import { createCourseOutlineController } from "./course-outline.js";
import {
  videoProgressMarkup,
  videoQuestionMarkup,
} from "./video-course.js";
import { createYouTubeSegmentPlayer } from "./youtube-player.js";

const CHOICES = ["А", "Б", "В"];
const BASIS_LABELS = {
  course: "По материалу курса",
  general: "Общие знания модели",
  mixed: "Курс и общие знания",
};
const activeYouTubeControllers = new Set();
let youtubeRenderEpoch = 0;

function disposeYouTubeController() {
  youtubeRenderEpoch += 1;
  for (const controller of activeYouTubeControllers) controller.destroy();
  activeYouTubeControllers.clear();
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value ?? "";
}

function generatedByLabel(item) {
  return item?.generatedBy?.label ?? "Ответ модели";
}

function currentAiProfileLabel(root) {
  const body = root.body ?? root.querySelector("body");
  return body?.dataset.aiProfileLabel ?? "Ответ модели";
}

function renderAiProfiles(payload, root) {
  const selector = root.querySelector("[data-role=ai-profile-select]");
  if (!selector) return;
  const profiles = payload?.profiles ?? [];
  selector.closest(".ai-profile-control")?.toggleAttribute("hidden", payload?.mode === "disabled");
  const document = selector.ownerDocument;
  selector.replaceChildren(...profiles.map((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    option.disabled = !profile.available;
    if (profile.unavailableReason) option.title = profile.unavailableReason;
    return option;
  }));
  selector.value = payload?.selectedProfileId ?? "";

  const selected = profiles.find((profile) => profile.id === selector.value);
  const body = root.body ?? root.querySelector("body");
  if (body) {
    body.dataset.aiProfileId = selected?.id ?? "";
    body.dataset.aiProfileLabel = selected?.label ?? "Ответ модели";
  }
}

async function initializeAiProfiles({ root, fetchImpl }) {
  const selector = root.querySelector("[data-role=ai-profile-select]");
  if (!selector) return null;
  const payload = await api("/api/ai/profiles", {}, fetchImpl);
  renderAiProfiles(payload, root);
  selector.dataset.selectedProfileId = payload.selectedProfileId;

  selector.addEventListener("change", async () => {
    const previousId = selector.dataset.selectedProfileId ?? payload.selectedProfileId;
    const nextId = selector.value;
    selector.disabled = true;
    try {
      const next = await api("/api/ai/profile", {
        method: "PUT",
        body: JSON.stringify({ profileId: nextId }),
      }, fetchImpl);
      renderAiProfiles(next, root);
      selector.dataset.selectedProfileId = next.selectedProfileId;
      hideError(root);
    } catch (error) {
      selector.value = previousId;
      showError(root, error.message);
    } finally {
      const body = root.body ?? root.querySelector("body");
      if (body?.dataset.busy !== "true") selector.disabled = false;
    }
  });
  return payload;
}

function choiceMarkup(choices, attribute, selected = null) {
  return CHOICES
    .filter((letter) => choices?.[letter])
    .map((letter) => `
      <button type="button" class="choice-button${selected === letter ? " is-selected" : ""}"
        ${attribute}="${letter}" ${selected ? "disabled" : ""}>
        <span class="choice-letter">${letter}</span>
        <span>${escapeHtml(choices[letter])}</span>
      </button>`)
    .join("");
}

function clarificationMarkup(messages = []) {
  return messages.map((message) => {
    if (message.role === "context-change") {
      const fromSize = message.fromUnitIds?.length ?? 0;
      const toSize = message.toUnitIds?.length ?? 0;
      return `<p class="clarification-context">Размер блока изменён: ${fromSize} → ${toSize}</p>`;
    }
    if (message.role === "user") {
      return `<article class="clarification-message is-user"><strong>Ты</strong><p>${escapeHtml(message.text)}</p></article>`;
    }
    return `<article class="clarification-message is-assistant">
      <div><strong>${escapeHtml(generatedByLabel(message))}</strong><span class="clarification-basis">${escapeHtml(BASIS_LABELS[message.basis] ?? "Ответ модели")}</span></div>
      <p>${escapeHtml(message.text)}</p>
    </article>`;
  }).join("");
}

function layerMarkup(layer) {
  if (layer.kind === "detail") {
    return `<article class="layer">
      <h3>Подробнее <span class="ai-answer-model">${escapeHtml(generatedByLabel(layer))}</span></h3>
      <p>${escapeHtml(layer.explanation)}</p>
      <p><strong>Пример:</strong> ${escapeHtml(layer.example)}</p>
      <p><strong>Важно:</strong> ${escapeHtml(layer.caveat)}</p>
    </article>`;
  }
  if (layer.kind === "rephrase") {
    return `<article class="layer">
      <h3>Другими словами <span class="ai-answer-model">${escapeHtml(generatedByLabel(layer))}</span></h3>
      <p>${escapeHtml(layer.explanation)}</p>
      <p><strong>Аналогия:</strong> ${escapeHtml(layer.analogy)}</p>
      <p>Если блок всё ещё тяжёлый, нажми минус в верхней панели.</p>
    </article>`;
  }
  return "";
}

function practiceFeedbackMarkup(history = []) {
  const last = history.at(-1);
  if (!last?.review) return "";
  return `<p class="ai-answer-model">${escapeHtml(generatedByLabel(last.review))}</p>
    <p><strong>${last.review.correct ? "Верно." : "Нужно уточнить."}</strong> ${escapeHtml(last.review.feedback)}</p>
    <p>${escapeHtml(last.review.nextHint)}</p>`;
}

function preparedActivitiesMarkup(activities = []) {
  return activities.map((activity) => {
    const instructions = activity.instructions
      .map((instruction) => `<li>${escapeHtml(instruction)}</li>`)
      .join("");
    const result = activity.completed
      ? `<div class="prepared-result"><strong>Результат сохранён</strong><p>${escapeHtml(activity.result)}</p></div>`
      : `<label>Твой результат
          <textarea data-activity-result data-busy-control rows="3" placeholder="${escapeHtml(activity.confirmationPrompt)}"></textarea>
        </label>
        <button type="button" class="primary-button" data-action="activity-save" data-unit-id="${escapeHtml(activity.unitId)}">Сохранить результат</button>`;
    return `<article class="prepared-activity" data-activity-unit-id="${escapeHtml(activity.unitId)}">
      <span class="eyebrow">Подготовленная практика</span>
      <h2>${escapeHtml(activity.title)}</h2>
      <ol>${instructions}</ol>
      <p><strong>Ожидаемый результат:</strong> ${escapeHtml(activity.expectedResult)}</p>
      ${activity.projectHint ? `<p class="project-hint">Где выполнять: ${escapeHtml(activity.projectHint)}</p>` : ""}
      ${result}
    </article>`;
  }).join("");
}

function completedCount(view) {
  return Array.isArray(view.completedUnitIds)
    ? view.completedUnitIds.length
    : Math.round((view.progress ?? 0) * (view.totalUnits ?? 0));
}

function lessonTitle(view) {
  const titles = view.units?.map((unit) => unit.title) ?? [];
  if (titles.length === 0) return "Итог курса";
  if (titles.length === 1) return titles[0];

  const combined = titles.join(" + ");
  if (titles.length > 3 || combined.length > 100) {
    const first = (view.cursor ?? 0) + 1;
    return `Фрагменты ${first}-${first + titles.length - 1}`;
  }
  return combined;
}

function videoRenderKey(view) {
  const content = currentVideoArtifact(view)?.content;
  return view.courseMode === "video" && content && !["complete", "waiting-content"].includes(view.status)
    ? [view.courseId, view.videoChapter?.id, content.videoId, content.startSeconds, content.endSeconds].join(":")
    : "";
}

function renderVideoCourse(view, root, statsSuffix = "", preserveVideo = false) {
  const lessonSize = root.querySelector("[data-role=lesson-size]");
  if (lessonSize) lessonSize.hidden = true;
  setText(root, "[data-role=lesson-title]", lessonTitle(view));
  setText(root, "[data-role=lesson-kicker]", "Видеоглава");

  const lessonBody = root.querySelector("[data-role=lesson-body]");
  if (lessonBody && !preserveVideo) {
    lessonBody.dataset.videoKey = videoRenderKey(view);
    lessonBody.innerHTML = sectionGroupsMarkup(
      view.units?.length ? view.sectionGroups : [],
      view.sourceArtifacts,
      view.courseId,
      { includeUnitText: false },
    );
    wireArtifactFallbacks(root);
  }

  const videoProgress = root.querySelector("[data-role=video-progress]");
  if (videoProgress) {
    videoProgress.hidden = false;
    videoProgress.innerHTML = videoProgressMarkup(view.prepared, view.chapterPreparation);
  }

  const lessonActions = root.querySelector("[data-role=lesson-actions]");
  if (lessonActions) lessonActions.hidden = true;
  const layers = root.querySelector("[data-role=layers]");
  if (layers) layers.innerHTML = "";
  const clarification = root.querySelector("[data-role=clarification]");
  if (clarification) clarification.hidden = true;
  const practice = root.querySelector("[data-role=practice]");
  if (practice) practice.hidden = true;
  const preparedActivities = root.querySelector("[data-role=prepared-activities]");
  if (preparedActivities) {
    preparedActivities.hidden = true;
    preparedActivities.innerHTML = "";
  }

  const questionPanel = root.querySelector("[data-role=question-panel]");
  const terminal = ["waiting-content", "complete"].includes(view.status);
  if (questionPanel) questionPanel.hidden = !view.question || terminal;
  setText(root, "[data-role=question-kicker]", "Проверочный вопрос");
  setText(root, "[data-role=question]", view.question?.prompt ?? "");
  const questionChoices = root.querySelector("[data-role=question-choices]");
  if (questionChoices) {
    questionChoices.innerHTML = videoQuestionMarkup(view.question, view.questionReview);
  }
  const review = root.querySelector("[data-role=review]");
  if (review) review.innerHTML = "";

  const application = root.querySelector("[data-role=application]");
  if (application) application.hidden = true;
  const completion = root.querySelector("[data-role=completion]");
  if (completion) completion.hidden = !terminal;
  const completionText = view.status === "waiting-content"
    ? "Эта глава пройдена. Следующая глава ещё готовится."
    : "Видеокурс завершён.";
  setText(root, "[data-role=completion-text]", terminal ? completionText + statsSuffix : "");

  const next = root.querySelector("[data-action=next]");
  if (next) {
    next.hidden = view.status !== "video-question-reviewed";
    next.disabled = view.status !== "video-question-reviewed";
    next.textContent = "Следующий вопрос";
  }
  const statusMessages = {
    "awaiting-video-question": "Ответь на вопрос по этой главе",
    "video-question-reviewed": "Ответ разобран, можно перейти к следующему вопросу",
    "waiting-content": "Глава завершена. Следующая появится после подготовки.",
    complete: "Видеокурс завершён",
  };
  setText(root, "[data-role=status-line]", view.skipNotice ?? statusMessages[view.status] ?? "");
}

function currentVideoArtifact(view) {
  return (view.sourceArtifacts ?? []).find((artifact) => artifact.content?.type === "youtube") ?? null;
}

async function mountYouTubeArtifact({ view, element, artifact, segmentId, fetchImpl, youtube, epoch, saveProgress }) {
  const content = artifact?.content;
  const showFallback = () => {
    const fallback = element.closest("[data-artifact-id]")?.querySelector("[data-youtube-fallback]");
    if (fallback) fallback.hidden = false;
  };
  if (!element || !content || !segmentId) return;
  try {
    const controller = await createYouTubeSegmentPlayer({
      element,
      videoId: content.videoId,
      startSeconds: content.startSeconds,
      endSeconds: content.endSeconds,
      ...(saveProgress ? { saved: view.videoProgress } : {}),
      youtube,
      ...(saveProgress ? {
        onSave: (positionSeconds) => api(
          `/api/courses/${encodeURIComponent(view.courseId)}/video-progress/${encodeURIComponent(segmentId)}`,
          {
            method: "PUT",
            body: JSON.stringify({ positionSeconds }),
            keepalive: true,
          },
          fetchImpl,
        ),
      } : {}),
      onError: showFallback,
    });
    if (epoch !== youtubeRenderEpoch) {
      controller.destroy();
      return;
    }
    activeYouTubeControllers.add(controller);
    element.closest("[data-screen=lesson]")?.querySelectorAll("[data-transcript-seek]").forEach((button) => {
      button.addEventListener("click", () => {
        controller.seekTo(Number(button.dataset.transcriptSeek));
      });
    });
  } catch {
    showFallback();
  }
}

async function mountYouTubeController(view, root, runtime, epoch) {
  const element = root.querySelector('[data-screen="lesson"] [data-youtube-player]');
  const artifact = currentVideoArtifact(view);
  const segmentId = view.videoChapter?.id ?? view.units?.[0]?.id;
  await mountYouTubeArtifact({
    view,
    element,
    artifact,
    segmentId,
    ...runtime,
    epoch,
    saveProgress: true,
  });
}

async function mountReviewYouTubeControllers(review, root, runtime, epoch) {
  const reviewScreen = root.querySelector('[data-screen="review"]');
  const artifactById = new Map((review.sourceArtifacts ?? []).map((artifact) => [artifact.id, artifact]));
  const elements = [...(reviewScreen?.querySelectorAll("[data-youtube-player]") ?? [])];
  await Promise.all(elements.map((element) => {
    const artifactId = element.closest("[data-artifact-id]")?.dataset.artifactId;
    const artifact = artifactById.get(artifactId);
    return mountYouTubeArtifact({
      view: review,
      element,
      artifact,
      segmentId: review.unit?.id,
      ...runtime,
      epoch,
      saveProgress: false,
    });
  }));
}

function renderReadingModeControls(view, root) {
  const readingToggle = root.querySelector("[data-action=toggle-reading-mode]");
  if (readingToggle) {
    readingToggle.hidden = false;
    readingToggle.dataset.enabled = view.readingMode ? "1" : "0";
    readingToggle.textContent = view.readingMode ? "Режим чтения: вкл" : "Режим чтения: выкл";
  }
  const readingPlate = root.querySelector("[data-role=reading-mode-plate]");
  if (readingPlate) {
    readingPlate.hidden = !view.readingMode
      || ["awaiting-application", "complete", "waiting-content"].includes(view.status);
  }
  const awaitingQuestion = view.courseMode === "video"
    ? view.status === "awaiting-video-question"
    : view.status === "awaiting-answer";
  const questionSkip = root.querySelector("[data-role=question-skip]");
  if (questionSkip) {
    questionSkip.hidden = !view.question
      || Boolean(view.readingMode)
      || !awaitingQuestion;
  }
  const stats = view.questionStats;
  return stats ? ` Вопросов отвечено: ${stats.answered}, пропущено: ${stats.skipped}.` : "";
}

export function render(view, root = document, runtime = {}) {
  (root.body ?? root.querySelector("body"))?.setAttribute("data-course-mode", view.courseMode ?? "article");
  const preserveVideo = Boolean(videoRenderKey(view)) && activeYouTubeControllers.size > 0
    && root.querySelector("[data-role=lesson-body]")?.dataset.videoKey === videoRenderKey(view);
  if (!preserveVideo) disposeYouTubeController();
  const total = view.totalUnits ?? 0;
  const done = completedCount(view);
  const body = root.body ?? root.querySelector("body");
  if (body && view.courseId) body.dataset.activeCourseId = view.courseId;
  if (body && view.playlistContext?.playlistId) body.dataset.activePlaylistId = view.playlistContext.playlistId;
  else if (body) delete body.dataset.activePlaylistId;
  if (body && view.units?.[0]?.id) body.dataset.activeUnitId = view.units[0].id;
  const lessonProgress = root.querySelector("[data-role=lesson-progress]");
  if (lessonProgress) lessonProgress.hidden = false;
  const lessonSize = root.querySelector("[data-role=lesson-size]");
  if (lessonSize) lessonSize.hidden = false;
  const allCourses = root.querySelector("[data-action=all-courses]");
  if (allCourses) allCourses.hidden = false;
  setText(root, "[data-role=course-title]", view.title ?? "Обучение Codex");
  setText(root, "[data-role=progress]", `${done} из ${total}`);
  setText(root, "[data-role=fragment-count]", view.actualSize ?? view.units?.length ?? 1);
  const progressBar = root.querySelector("[data-role=progress-bar]");
  if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(1, view.progress ?? 0)) * 100}%`;

  if (view.courseMode === "video") {
    const statsSuffix = renderReadingModeControls(view, root);
    const skipButton = root.querySelector("[data-action=skip-questions]");
    if (skipButton) skipButton.textContent = "Пропустить вопросы главы";
    renderVideoCourse(view, root, statsSuffix, preserveVideo);
    if (runtime.fetchImpl && !preserveVideo) {
      void mountYouTubeController(view, root, runtime, youtubeRenderEpoch);
    }
    return;
  }

  const videoProgress = root.querySelector("[data-role=video-progress]");
  if (videoProgress) {
    videoProgress.hidden = true;
    videoProgress.innerHTML = "";
  }

  setText(root, "[data-role=lesson-title]", lessonTitle(view));
  setText(root, "[data-role=lesson-kicker]", view.units?.length > 1 ? "Расширенный блок" : "Текущий блок");
  const statsSuffix = renderReadingModeControls(view, root);

  const lessonBody = root.querySelector("[data-role=lesson-body]");
  if (lessonBody) {
    lessonBody.innerHTML = sectionGroupsMarkup(
      view.units?.length ? view.sectionGroups : [],
      view.sourceArtifacts,
      view.courseId,
    );
    wireArtifactFallbacks(root);
  }

  const lessonActions = root.querySelector("[data-role=lesson-actions]");
  if (lessonActions) lessonActions.hidden = !view.units?.length || view.status === "complete";
  const layers = root.querySelector("[data-role=layers]");
  if (layers) layers.innerHTML = (view.layers ?? []).map(layerMarkup).join("");

  const clarification = root.querySelector("[data-role=clarification]");
  if (clarification) clarification.hidden = !view.units?.length;
  const clarificationMessages = root.querySelector("[data-role=clarification-messages]");
  if (clarificationMessages) {
    clarificationMessages.innerHTML = clarificationMarkup(view.clarificationThread?.messages);
  }

  const practice = root.querySelector("[data-role=practice]");
  const lastPractice = view.practiceHistory?.at(-1);
  const terminal = ["awaiting-application", "complete"].includes(view.status);
  if (practice) practice.hidden = terminal || (!view.practice && !lastPractice);
  setText(root, "[data-role=practice-task]", view.practice?.task ?? lastPractice?.practice?.task ?? "");
  setText(root, "[data-role=practice-model]", generatedByLabel(view.practice ?? lastPractice?.practice));
  const practiceAnswer = root.querySelector("[data-role=practice-answer]");
  if (practiceAnswer && view.practice) practiceAnswer.value = "";
  if (practiceAnswer) practiceAnswer.disabled = !view.practice;
  const practiceReview = root.querySelector("[data-action=practice-review]");
  if (practiceReview) practiceReview.disabled = !view.practice;
  const practiceFeedback = root.querySelector("[data-role=practice-feedback]");
  if (practiceFeedback) practiceFeedback.innerHTML = practiceFeedbackMarkup(view.practiceHistory);

  const preparedActivities = root.querySelector("[data-role=prepared-activities]");
  if (preparedActivities) {
    preparedActivities.hidden = !(view.activities?.length);
    preparedActivities.innerHTML = preparedActivitiesMarkup(view.activities);
  }

  const questionPanel = root.querySelector("[data-role=question-panel]");
  if (questionPanel) {
    questionPanel.hidden = !view.question
      || ["awaiting-application", "complete"].includes(view.status)
      || (view.status === "reviewed" && !view.answer);
  }
  setText(
    root,
    "[data-role=question-kicker]",
    view.questionCount > 1 ? `Вопрос ${view.questionPosition} из ${view.questionCount}` : "Проверочный вопрос",
  );
  setText(root, "[data-role=question]", view.question?.prompt ?? "");
  const questionChoices = root.querySelector("[data-role=question-choices]");
  if (questionChoices) questionChoices.innerHTML = choiceMarkup(view.question?.choices, "data-choice", view.answer?.choice);
  const review = root.querySelector("[data-role=review]");
  if (review) {
    review.innerHTML = view.answer
      ? `<p><strong>${view.answer.correct ? "Верно." : "Не совсем."}</strong> ${escapeHtml(view.answer.explanation)}</p>`
      : "";
  }

  const application = root.querySelector("[data-role=application]");
  if (application) application.hidden = view.status !== "awaiting-application";
  setText(root, "[data-role=application-prompt]", view.application?.prompt ?? "");
  const applicationChoices = root.querySelector("[data-role=application-choices]");
  if (applicationChoices) {
    applicationChoices.innerHTML = choiceMarkup(view.application?.choices, "data-application-choice");
  }

  const completion = root.querySelector("[data-role=completion]");
  if (completion) completion.hidden = view.status !== "complete";
  const selectedApplication = view.applicationChoice ? `Выбран вариант ${view.applicationChoice}.` : "";
  setText(root, "[data-role=completion-text]", `${selectedApplication} Результат сохранён в памяти курса.${statsSuffix}`);

  const next = root.querySelector("[data-action=next]");
  if (next) {
    next.disabled = !view.canGoNext;
    next.hidden = ["awaiting-application", "complete"].includes(view.status);
    next.textContent = view.nextAction === "question" ? "Следующий вопрос" : "Следующий блок";
  }
  const statusMessages = {
    "awaiting-answer": "Сначала ответь на вопрос",
    reviewed: view.nextAction === "question"
      ? `Ответ разобран, далее вопрос ${view.questionPosition + 1} из ${view.questionCount}`
      : "Ответ разобран, можно двигаться дальше",
    "awaiting-application": "Выбери одно применение в живом проекте",
    complete: "Курс завершён",
  };
  setText(root, "[data-role=status-line]", view.skipNotice ?? statusMessages[view.status] ?? "");

  const decrease = root.querySelector("[data-action=decrease]");
  if (decrease) decrease.disabled = !view.canDecrease;
  const increase = root.querySelector("[data-action=increase]");
  const sizeLabels = {
    "article-end": "Конец курса",
  };
  const sizeLabel = sizeLabels[view.sizeLimitReason] ?? "";
  setText(root, "[data-role=size-limit]", sizeLabel);
  if (increase) {
    increase.disabled = !view.canIncrease;
    increase.title = view.sizeLimitReason === "article-end"
      ? "Конец курса"
      : "Увеличить учебный блок";
  }
}

export async function api(path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || "Не удалось выполнить действие");
    error.code = body.code;
    throw error;
  }
  return body;
}

function setActionStatus(root, value = "") {
  const status = root.querySelector("[data-role=action-status]");
  if (!status) return;
  status.textContent = value;
  status.hidden = !value;
}

function setPracticeBusy(root, busy) {
  const button = root.querySelector("[data-action=practice]");
  if (!button) return;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

function revealPractice(root) {
  root.querySelector("[data-role=practice]")?.scrollIntoView?.({
    behavior: "smooth",
    block: "start",
  });
}

function revealQuestions(root) {
  root.querySelector("[data-role=question-panel]")?.scrollIntoView?.({
    behavior: "smooth",
    block: "start",
  });
}

function revealLessonStart(root) {
  const viewWindow = root.defaultView ?? globalThis.window;
  const lessonTitle = root.querySelector("[data-role=lesson-title]");
  if (!viewWindow?.scrollTo || !lessonTitle) return;

  const header = root.querySelector(".course-header");
  const scrollY = viewWindow.scrollY ?? 0;
  const titleTop = lessonTitle.getBoundingClientRect().top + scrollY;
  const headerHeight = header?.getBoundingClientRect().height ?? 0;
  const reducedMotion = viewWindow.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  viewWindow.scrollTo({
    top: Math.max(0, titleTop - headerHeight - 20),
    behavior: reducedMotion ? "auto" : "smooth",
  });
}

function setBusy(root, busy, restore = true) {
  const body = root.body ?? root.querySelector("body");
  if (body) body.dataset.busy = String(busy);
  root.querySelectorAll("[data-action], [data-busy-control]").forEach((button) => {
    if (busy) {
      button.dataset.wasDisabled = String(button.disabled);
      button.disabled = true;
    } else if (button.dataset.wasDisabled) {
      if (restore) button.disabled = button.dataset.wasDisabled === "true";
      delete button.dataset.wasDisabled;
    }
  });
}

function showError(root, message) {
  const banner = root.querySelector("[data-role=error]");
  if (banner) banner.hidden = false;
  setText(root, "[data-role=error-message]", message);
}

function hideError(root) {
  const banner = root.querySelector("[data-role=error]");
  if (banner) banner.hidden = true;
}

export function wireActions({
  root = document,
  fetchImpl = fetch,
  renderOptions = { fetchImpl },
  onOpenCourse = null,
  onCatalog = null,
  onArchiveCourse = null,
  onRestoreCourse = null,
  onOpenPlaylist = null,
  onArchivePlaylist = null,
  onRestorePlaylist = null,
  onPlaylistBoundary = null,
  onToggleOutline = null,
  onSortCourses = null,
} = {}) {
  let lastAction = null;
  const handledPlaylistBoundaries = new Set();

  const activeCourseId = () => (root.body ?? root.querySelector("body"))?.dataset.activeCourseId;
  const courseApi = (suffix) => {
    const courseId = activeCourseId();
    if (!courseId) throw new Error("Сначала открой курс.");
    return `/api/courses/${encodeURIComponent(courseId)}${suffix}`;
  };

  const sendReadingMode = async (enabled) => {
    try {
      hideError(root);
      const view = await api(courseApi("/reading-mode"), {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }, fetchImpl);
      render(view, root, renderOptions);
    } catch (error) {
      showError(root, error.message);
    }
  };

  const run = async (suffix, body) => {
    const action = { suffix, body };
    const isClarification = suffix === "/clarification";
    const isPractice = suffix === "/practice";
    const clarificationStatus = root.querySelector("[data-role=clarification-status]");
    const profileLabel = currentAiProfileLabel(root);
    lastAction = action;
    let busy = true;
    hideError(root);
    if (isClarification && clarificationStatus) {
      clarificationStatus.textContent = `${profileLabel} отвечает…`;
      clarificationStatus.hidden = false;
    }
    if (isPractice) {
      setActionStatus(root, `${profileLabel} готовит практику…`);
      setPracticeBusy(root, true);
    }
    setBusy(root, true);
    const applyView = async (view) => {
      if (busy) {
        setBusy(root, false);
        busy = false;
      }
      const previousUnitId = (root.body ?? root.querySelector("body"))?.dataset.activeUnitId;
      const previousCourseId = activeCourseId();
      render(view, root, renderOptions);
      const playlistContext = view.playlistContext;
      if (suffix === "/next" && playlistContext?.lessonCompleted && playlistContext.playlistId) {
        const boundaryKey = `${playlistContext.playlistId}:${previousCourseId ?? playlistContext.lessonCourseId}`;
        if (!handledPlaylistBoundaries.has(boundaryKey)) {
          handledPlaylistBoundaries.add(boundaryKey);
          await onPlaylistBoundary?.({ view, previousCourseId });
        }
        return view;
      }
      if (suffix === "/next" && view.units?.length) {
        const nextUnitId = view.units?.[0]?.id;
        if (nextUnitId !== previousUnitId) {
          revealLessonStart(root);
        } else {
          revealQuestions(root);
        }
      }
      if (isPractice && view.practice) revealPractice(root);
      if (isClarification) {
        const input = root.querySelector("[data-role=clarification-input]");
        if (input) input.value = "";
      }
      return view;
    };
    try {
      const view = await api(courseApi(suffix), {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, fetchImpl);
      return applyView(view);
    } catch (error) {
      if (isPractice) {
        try {
          const current = await api(courseApi("/session"), {}, fetchImpl);
          if (current.practice) {
            hideError(root);
            return applyView(current);
          }
        } catch {
          // Keep the original practice error for the user.
        }
      }
      showError(root, error.message);
      return null;
    } finally {
      if (busy) setBusy(root, false);
      if (isClarification && clarificationStatus) clarificationStatus.hidden = true;
      if (isPractice) {
        setActionStatus(root);
        setPracticeBusy(root, false);
      }
    }
  };

  const submitClarification = async () => {
    const input = root.querySelector("[data-role=clarification-input]");
    const question = input?.value.trim();
    if (!question) {
      showError(root, "Сначала напиши уточняющий вопрос.");
      return;
    }
    await run("/clarification", { question });
  };

  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;

    if (["open-course", "continue-course"].includes(button.dataset.action)) {
      onOpenCourse?.(button.dataset.courseId);
    } else if (button.dataset.action === "open-playlist") {
      onOpenPlaylist?.(button.dataset.playlistId, {});
    } else if (button.dataset.action === "playlist-outline") {
      onOpenPlaylist?.(button.dataset.playlistId, { outlineOnly: true });
    } else if (button.dataset.action === "toggle-inline-outline") {
      onToggleOutline?.({ courseId: button.dataset.courseId, button });
    } else if (button.dataset.action === "toggle-collection-outline") {
      const panel = button.closest(".course-collection")?.querySelector("[data-collection-outline]");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
    } else if (button.dataset.action === "toggle-archive") {
      const panel = root.querySelector("[data-role=archived-grid]");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
    } else if (button.dataset.action === "toggle-completed") {
      const panel = root.querySelector("[data-role=completed-grid]");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
    } else if (button.dataset.action === "sort-courses") {
      onSortCourses?.(button.dataset.sort);
    } else if (button.dataset.action === "expand-inline-outline") {
      const panel = button.closest("[data-inline-outline]");
      const outline = panel?.__outline;
      if (panel && outline) rerenderInlineOutline(panel, outline);
    } else if (button.dataset.action === "all-courses") {
      onCatalog?.();
    } else if (button.dataset.action === "archive-course") {
      onArchiveCourse?.(button.dataset.courseId);
    } else if (button.dataset.action === "restore-course") {
      onRestoreCourse?.(button.dataset.courseId);
    } else if (button.dataset.action === "archive-playlist") {
      onArchivePlaylist?.(button.dataset.playlistId);
    } else if (button.dataset.action === "restore-playlist") {
      onRestorePlaylist?.(button.dataset.playlistId);
    } else if (button.dataset.action === "skip-questions") {
      run("/skip-questions");
    } else if (button.dataset.action === "enable-reading-mode") {
      void sendReadingMode(true);
    } else if (button.dataset.action === "disable-reading-mode") {
      void sendReadingMode(false);
    } else if (button.dataset.action === "toggle-reading-mode") {
      void sendReadingMode(button.dataset.enabled !== "1");
    } else if (button.dataset.videoChoice) {
      const questionId = button.dataset.videoQuestionId;
      if (!questionId) {
        showError(root, "Вопрос временно недоступен.");
        return;
      }
      run(`/questions/${encodeURIComponent(questionId)}/answer`, { choice: button.dataset.videoChoice });
    } else if (button.dataset.choice) run("/answer", { choice: button.dataset.choice });
    else if (button.dataset.applicationChoice) run("/application", { choice: button.dataset.applicationChoice });
    else if (button.dataset.action === "increase") run("/resize", { delta: 1 });
    else if (button.dataset.action === "decrease") run("/resize", { delta: -1 });
    else if (button.dataset.action === "next") run("/next");
    else if (button.dataset.action === "detail") run("/ai/detail");
    else if (button.dataset.action === "rephrase") run("/ai/rephrase");
    else if (button.dataset.action === "practice") run("/practice");
    else if (button.dataset.action === "clarification-submit") submitClarification();
    else if (button.dataset.action === "activity-save") {
      const activity = button.closest("[data-activity-unit-id]");
      const result = activity?.querySelector("[data-activity-result]")?.value.trim();
      if (!result) {
        showError(root, "Сначала коротко опиши результат практики.");
        return;
      }
      run("/activity", { unitId: button.dataset.unitId, result });
    }
    else if (button.dataset.action === "practice-review") {
      const answer = root.querySelector("[data-role=practice-answer]")?.value.trim();
      if (!answer) {
        showError(root, "Сначала напиши свой вариант ответа.");
        return;
      }
      run("/practice/review", { answer });
    } else if (button.dataset.action === "retry" && lastAction) {
      run(lastAction.suffix, lastAction.body);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.target.matches("[data-role=clarification-input]")
        && event.key === "Enter"
        && !event.shiftKey) {
      event.preventDefault();
      submitClarification();
    }
  });

  return { run };
}

function showScreen(root, name) {
  root.querySelectorAll("[data-screen]").forEach((screen) => {
    screen.hidden = screen.dataset.screen !== name;
  });
  const lessonVisible = name === "lesson";
  const courseContextVisible = lessonVisible || name === "review";
  const lessonProgress = root.querySelector("[data-role=lesson-progress]");
  if (lessonProgress) lessonProgress.hidden = !lessonVisible;
  const lessonSize = root.querySelector("[data-role=lesson-size]");
  if (lessonSize) lessonSize.hidden = !lessonVisible || (root.body ?? root.querySelector("body"))?.dataset.courseMode === "video";
  const allCourses = root.querySelector("[data-action=all-courses]");
  if (allCourses) allCourses.hidden = !courseContextVisible;
  const readingToggle = root.querySelector("[data-action=toggle-reading-mode]");
  if (readingToggle) readingToggle.hidden = !lessonVisible;
  const lessonOutline = root.querySelector("[data-action=lesson-outline]");
  if (lessonOutline) lessonOutline.hidden = !lessonVisible;
  if (!courseContextVisible) setText(root, "[data-role=course-title]", "Мои курсы");
}

function setCatalogMessage(root, message = "") {
  const element = root.querySelector("[data-role=catalog-message]");
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}

export async function bootstrap({ root = document, fetchImpl = fetch } = {}) {
  initThemeControl({
    root: root.documentElement ?? root,
    button: root.querySelector("[data-role=theme-toggle]"),
  });
  const viewWindow = root.defaultView ?? globalThis.window;
  const history = viewWindow?.history;
  let outlineController = null;
  let catalogPayload = null;

  try {
    await initializeAiProfiles({ root, fetchImpl });
  } catch (error) {
    const selector = root.querySelector("[data-role=ai-profile-select]");
    if (selector) selector.disabled = true;
    showError(root, error.message);
  }

  const openCatalog = async ({ push = false, message = "" } = {}) => {
    disposeYouTubeController();
    try {
      outlineController?.close({ restoreFocus: false });
      const payload = await api("/api/courses", {}, fetchImpl);
      if (push) history?.pushState({}, "", "/");
      const body = root.body ?? root.querySelector("body");
      if (body) {
        delete body.dataset.activeCourseId;
        delete body.dataset.activePlaylistId;
      }
      catalogPayload = payload;
      renderCatalog(payload, root);
      setCatalogMessage(root, message);
      hideError(root);
      showScreen(root, "catalog");
      return payload;
    } catch (error) {
      showScreen(root, "catalog");
      setCatalogMessage(root, error.message);
      return null;
    }
  };

  const applyCourseSort = (mode) => {
    toggleCourseSort(mode);
    if (catalogPayload) renderCatalog(catalogPayload, root);
  };

  const openCourse = async (courseId, { push = false } = {}) => {
    try {
      const view = await api(`/api/courses/${encodeURIComponent(courseId)}/session`, {}, fetchImpl);
      if (view.kind === "outline" && view.outline?.playlistId) {
        await openCatalog();
        return openPlaylist(view.outline.playlistId, {
          replace: true,
          origin: "catalog",
          outlineOnly: true,
          notice: view.notice ?? "",
        });
      }
      if (view.playlistContext?.lessonCompleted && view.playlistContext.playlistId) {
        return openPlaylist(view.playlistContext.playlistId, {
          replace: true,
          origin: "lesson",
          outlineOnly: true,
          notice: `Урок завершён: ${view.playlistContext.lessonTitle}. Выбери следующий ролик в оглавлении.`,
        });
      }
      if (push) history?.pushState({}, "", coursePath(courseId));
      hideError(root);
      render(view, root, { fetchImpl });
      showScreen(root, "lesson");
      return view;
    } catch (error) {
      if (["COURSE_NOT_FOUND", "COURSE_UNAVAILABLE"].includes(error.code)) {
        history?.replaceState({}, "", "/");
        return openCatalog({ message: error.message });
      }
      showError(root, error.message);
      return null;
    }
  };

  const openPlaylist = async (playlistId, {
    lessonCourseId,
    push = false,
    replace = false,
    outlineOnly = false,
    origin = "catalog",
    trigger,
    notice = "",
  } = {}) => {
    const pathname = `/playlist/${encodeURIComponent(playlistId)}`;
    try {
      outlineController?.close({ restoreFocus: false });
      const result = outlineOnly
        ? { kind: "outline", outline: await api(`/api/playlists/${encodeURIComponent(playlistId)}/outline`, {}, fetchImpl) }
        : await api(`/api/playlists/${encodeURIComponent(playlistId)}/open`, {
          method: "POST",
          ...(lessonCourseId ? { body: JSON.stringify({ lessonCourseId }) } : {}),
        }, fetchImpl);
      if (viewWindow?.location?.pathname !== pathname) {
        if (push) history?.pushState({}, "", pathname);
        else if (replace) history?.replaceState({}, "", pathname);
      }
      hideError(root);
      if (result.kind === "outline") {
        showScreen(root, origin === "lesson" ? "lesson" : "catalog");
        await outlineController?.open({
          playlistId,
          origin,
          trigger,
          notice: notice || result.notice || "",
          outlineData: result.outline,
        });
        return result;
      }
      const view = result.view ?? result;
      render(view, root, { fetchImpl });
      showScreen(root, "lesson");
      return view;
    } catch (error) {
      if (["PLAYLIST_NOT_FOUND", "PLAYLIST_LESSON_NOT_READY", "PLAYLIST_LESSON_FORBIDDEN"].includes(error.code)) {
        showScreen(root, origin === "lesson" ? "lesson" : "catalog");
      }
      showError(root, error.message);
      return null;
    }
  };

  outlineController = createCourseOutlineController({
    root,
    request: (path) => api(path, {}, fetchImpl),
    onOpenCurrentCourse: (courseId) => openCourse(courseId, { push: true }),
    onOpenPlaylist: (playlistId, options = {}) => openPlaylist(playlistId, { ...options, push: true }),
    onShowReview: (review) => {
      disposeYouTubeController();
      const body = root.body ?? root.querySelector("body");
      if (body) body.dataset.activeCourseId = review.courseId;
      setText(root, "[data-role=course-title]", review.courseTitle);
      showScreen(root, "review");
      void mountReviewYouTubeControllers(review, root, { fetchImpl }, youtubeRenderEpoch);
    },
    onReturnCurrent: async (courseId, context) => {
      disposeYouTubeController();
      if (context.playlistId) {
        const result = await openPlaylist(context.playlistId, {
          origin: context.origin,
          push: context.origin === "catalog",
          replace: context.origin === "lesson",
        });
        if (result?.kind !== "outline" && result) revealLessonStart(root);
        return result;
      }
      const view = await openCourse(courseId, { push: context.origin === "catalog" });
      if (view) revealLessonStart(root);
      return view;
    },
  });

  const routeFromLocation = async () => {
    const pathname = viewWindow?.location?.pathname ?? "/";
    const playlistMatch = pathname.match(/^\/playlist\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/u);
    if (playlistMatch) return openPlaylist(playlistMatch[1], { origin: "catalog" });
    const courseId = courseIdFromPath(pathname);
    return courseId ? openCourse(courseId) : openCatalog();
  };

  wireActions({
    root,
    fetchImpl,
    renderOptions: { fetchImpl },
    onOpenCourse: (courseId) => openCourse(courseId, { push: true }),
    onCatalog: () => openCatalog({ push: true }),
    onArchiveCourse: async (courseId) => {
      try {
        await api(`/api/courses/${encodeURIComponent(courseId)}/archive`, { method: "POST" }, fetchImpl);
        await openCatalog({ message: "Курс перемещён в архив." });
      } catch (error) {
        setCatalogMessage(root, error.message);
      }
    },
    onRestoreCourse: async (courseId) => {
      try {
        await api(`/api/courses/${encodeURIComponent(courseId)}/restore`, { method: "POST" }, fetchImpl);
        await openCatalog({ message: "Курс возвращён из архива." });
      } catch (error) {
        setCatalogMessage(root, error.message);
      }
    },
    onOpenPlaylist: (playlistId, options = {}) => {
      const screen = [...root.querySelectorAll("[data-screen]")].find((element) => !element.hidden)?.dataset.screen;
      return openPlaylist(playlistId, {
        ...options,
        origin: screen === "lesson" ? "lesson" : "catalog",
        push: true,
      });
    },
    onPlaylistBoundary: async ({ view }) => openPlaylist(view.playlistContext.playlistId, {
      origin: "lesson",
      replace: true,
      outlineOnly: true,
      notice: `Урок завершён: ${view.playlistContext.lessonTitle}. Выбери следующий ролик в оглавлении.`,
    }),
    onArchivePlaylist: async (playlistId) => {
      try {
        await api(`/api/playlists/${encodeURIComponent(playlistId)}/archive`, { method: "POST" }, fetchImpl);
        await openCatalog({ message: "Плейлист перемещён в архив." });
      } catch (error) {
        setCatalogMessage(root, error.message);
      }
    },
    onRestorePlaylist: async (playlistId) => {
      try {
        await api(`/api/playlists/${encodeURIComponent(playlistId)}/restore`, { method: "POST" }, fetchImpl);
        await openCatalog({ message: "Плейлист возвращён из архива." });
      } catch (error) {
        setCatalogMessage(root, error.message);
      }
    },
    onSortCourses: applyCourseSort,
    onToggleOutline: async ({ courseId, button }) => {
      const row = button.closest("[data-course-card]");
      const panel = row?.querySelector("[data-inline-outline]");
      if (!row || !panel) return;
      const isOpen = !panel.hidden;
      panel.hidden = isOpen;
      button.setAttribute("aria-expanded", String(!isOpen));
      if (isOpen || panel.__outline) return;
      panel.hidden = false;
      panel.innerHTML = '<p class="inline-outline-loading">Загрузка содержания...</p>';
      try {
        const outline = await api(`/api/courses/${encodeURIComponent(courseId)}/outline`, {}, fetchImpl);
        panel.__outline = outline;
        renderInlineOutline(panel, outline);
      } catch (error) {
        panel.innerHTML = `<p class="inline-outline-empty">${escapeHtml(error.message)}</p>`;
      }
    },
  });
  viewWindow?.addEventListener?.("popstate", routeFromLocation);
  return routeFromLocation();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => bootstrap());
}
