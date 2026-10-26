import {
  escapeHtml,
  reviewMarkup,
  wireArtifactFallbacks,
} from "./course-content.js";
import { playlistOutlineMarkup } from "./playlist-outline.js";

const STATUS = {
  completed: { symbol: "✓", label: "Пройдено" },
  current: { symbol: "●", label: "Текущий блок" },
  available: { symbol: "○", label: "Подготовлено" },
  locked: { symbol: "🔒", label: "Пока закрыто" },
  planned: { symbol: "○", label: "ещё не подготовлено" },
  unavailable: { symbol: "!", label: "Требует проверки" },
};

function progressPercent(progress) {
  if (!progress?.total) return 0;
  return Math.round(
    Math.max(0, Math.min(1, progress.completed / progress.total)) * 100,
  );
}

function progressMarkup(progress, label, { course = false } = {}) {
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  return `<div class="${course ? "outline-summary" : "outline-section-progress"}"${course ? ' data-role="outline-course-progress"' : ""}>
    <span>${completed} из ${total}</span>
    <span class="outline-progress-track" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}">
      <span style="width: ${progressPercent(progress)}%"></span>
    </span>
  </div>`;
}

function unitMarkup(unit) {
  const status = STATUS[unit.status] ?? STATUS.locked;
  const disabled = ["locked", "planned", "unavailable"].includes(unit.status) ? " disabled" : "";
  return `<button type="button" class="outline-unit is-${escapeHtml(unit.status)}" data-outline-action="open-unit" data-unit-id="${escapeHtml(unit.id)}" data-outline-unit-status="${escapeHtml(unit.status)}"${disabled}>
    <span class="outline-unit-mark" aria-hidden="true">${status.symbol}</span>
    <span class="outline-unit-title">${escapeHtml(unit.title)}</span>
    <span class="sr-only">${status.label}</span>
  </button>`;
}

function roadmapItemMarkup(item) {
  const status = STATUS[item.status] ?? STATUS.planned;
  const disabled = ["planned", "unavailable"].includes(item.status) ? " disabled" : "";
  const course = item.courseId ? ` data-course-id="${escapeHtml(item.courseId)}"` : "";
  const presence = item.courseId ? "published" : "planned";
  const presenceLabel = item.courseId ? "В системе" : "Запланировано";
  return `<button type="button" class="outline-unit outline-roadmap-item is-${escapeHtml(item.status)}" data-outline-action="open-roadmap-item" data-roadmap-item-status="${escapeHtml(item.status)}"${course}${disabled}>
    <span class="outline-unit-mark" aria-hidden="true">${status.symbol}</span>
    <span class="outline-unit-title">${escapeHtml(item.title)}</span>
    <span class="outline-roadmap-presence is-${presence}" data-roadmap-presence="${presence}">${presenceLabel}</span>
    <span class="sr-only">${status.label}</span>
  </button>`;
}

function roadmapMarkup(roadmap, expandedSectionIds) {
  const progress = roadmap.progress;
  return `<section class="outline-roadmap" data-role="course-roadmap">
    <h3 class="outline-subtitle">Полный маршрут: ${escapeHtml(roadmap.title)}</h3>
    <p class="outline-roadmap-meta">Завершено частей: ${progress.completed} из ${progress.total}. Подготовлено: ${progress.prepared} из ${progress.total}.</p>
    <p class="outline-roadmap-legend"><span class="outline-roadmap-presence is-published">В системе</span> подготовленная часть курса. <span class="outline-roadmap-presence is-planned">Запланировано</span> часть появится после подготовки.</p>
    ${roadmap.sections.map((section) => roadmapSectionMarkup(
      section,
      expandedSectionIds.has(section.id),
    )).join("")}
  </section>`;
}

function roadmapSectionMarkup(section, expanded) {
  const id = `roadmap-section-${escapeHtml(section.id)}`;
  return `<section class="outline-section outline-roadmap-section" data-roadmap-section="${escapeHtml(section.id)}">
    <button type="button" class="outline-section-toggle" data-outline-action="toggle-roadmap-section" data-roadmap-section-id="${escapeHtml(section.id)}" aria-expanded="${expanded}" aria-controls="${id}">
      <span>${escapeHtml(section.title)}</span>
      <span>${section.items.length}</span>
    </button>
    <div id="${id}" data-roadmap-section-body${expanded ? "" : " hidden"}>
      ${section.items.map(roadmapItemMarkup).join("")}
    </div>
  </section>`;
}

export function outlineMarkup(outline, expandedSectionIds = new Set()) {
  const prepared = outline.prepared
    ? `<p class="video-segment-meta">Пройдено глав: ${outline.prepared.completed} из ${outline.prepared.total}. Подготовлено: ${outline.chapterPreparation?.ready ?? 0} из ${outline.chapterPreparation?.total ?? 0}.</p>`
    : "";
  const roadmap = outline.roadmap
    ? roadmapMarkup(outline.roadmap, outline.expandedRoadmapSectionIds ?? new Set())
    : "";
  const localTitle = outline.roadmap
    ? '<h3 class="outline-subtitle">Фрагменты этой части</h3>'
    : "";
  return progressMarkup(outline.progress, "Прогресс курса", { course: true })
    + prepared
    + roadmap
    + localTitle
    + outline.sections.map((section) => sectionMarkup(
      section,
      expandedSectionIds.has(section.id),
    )).join("");
}

function sectionMarkup(section, expanded) {
  const id = `outline-section-${escapeHtml(section.id)}`;
  return `<section class="outline-section" data-outline-section="${escapeHtml(section.id)}">
    <button type="button" class="outline-section-toggle" data-outline-action="toggle-section" data-section-id="${escapeHtml(section.id)}" aria-expanded="${expanded}" aria-controls="${id}">
      <span>${escapeHtml(section.title)}</span>
      <span>${section.progress.completed} из ${section.progress.total}</span>
    </button>
    ${progressMarkup(section.progress, `Прогресс раздела ${section.title}`)}
    <div id="${id}" data-outline-section-body${expanded ? "" : " hidden"}>
      ${section.units.map(unitMarkup).join("")}
    </div>
  </section>`;
}

function focusableIn(drawer) {
  return [...drawer.querySelectorAll("button:not(:disabled), a[href], [tabindex]")]
    .filter((element) => !element.closest("[hidden]"));
}

export function createCourseOutlineController({
  root = document,
  request,
  onOpenCurrentCourse = () => {},
  onOpenPlaylist = () => {},
  onShowReview = () => {},
  onReturnCurrent = () => {},
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("Course outline request function is required");
  }

  const overlay = root.querySelector("[data-role=course-outline]");
  const drawer = root.querySelector(".outline-drawer");
  const title = root.querySelector("#outline-title");
  const loading = root.querySelector("[data-role=outline-loading]");
  const errorPanel = root.querySelector("[data-role=outline-error]");
  const errorMessage = root.querySelector("[data-role=outline-error-message]");
  const content = root.querySelector("[data-role=outline-content]");
  const playlistNotice = root.querySelector("[data-role=playlist-notice]");
  const reviewContent = root.querySelector('[data-screen="review"] [data-role="review-content"]');
  const body = root.body ?? root.querySelector("body");

  let currentCourseId = null;
  let currentPlaylistId = null;
  let origin = "catalog";
  let opener = null;
  let outline = null;
  let expandedSectionIds = new Set();
  let expandedRoadmapSectionIds = new Set();
  let expandedLessonIds = new Set();
  let retryAction = null;
  let reviewOrigin = "catalog";
  let reviewContext = null;

  const setLoading = (active) => {
    if (loading) loading.hidden = !active;
  };

  const hideLocalError = () => {
    if (errorPanel) errorPanel.hidden = true;
    if (errorMessage) errorMessage.textContent = "";
  };

  const showLocalError = (message) => {
    if (errorMessage) errorMessage.textContent = message || "Не удалось загрузить оглавление.";
    if (errorPanel) errorPanel.hidden = false;
  };

  const renderOutline = () => {
    if (!outline || !content) return;
    title.textContent = outline.title;
    content.innerHTML = currentPlaylistId
      ? playlistOutlineMarkup(outline, expandedLessonIds)
      : outlineMarkup({
        ...outline,
        expandedRoadmapSectionIds,
      }, expandedSectionIds);
  };

  const prepareOutline = (nextOutline) => {
    outline = nextOutline;
    expandedSectionIds = new Set(
      (outline.sections ?? [])
        .filter((section) => section.containsCurrent)
        .map((section) => section.id),
    );
    if (!currentPlaylistId && expandedSectionIds.size === 0 && outline.sections?.[0]) {
      expandedSectionIds.add(outline.sections[0].id);
    }
    expandedLessonIds = new Set(currentPlaylistId
      ? outline.sections.flatMap((section) => [
        ...(section.lessons.some((lesson) => lesson.isCurrent) ? [`section:${section.id}`] : []),
        ...section.lessons.filter((lesson) => lesson.isCurrent).map((lesson) => lesson.id),
      ])
      : []);
    expandedRoadmapSectionIds = new Set(
      outline.roadmap?.sections.map((section) => section.id) ?? [],
    );
    renderOutline();
    hideLocalError();
    title?.focus();
  };

  const loadOutline = async () => {
    retryAction = loadOutline;
    hideLocalError();
    setLoading(true);
    if (content) content.innerHTML = "";
    try {
      outline = await request(currentPlaylistId
        ? `/api/playlists/${encodeURIComponent(currentPlaylistId)}/outline`
        : `/api/courses/${encodeURIComponent(currentCourseId)}/outline`);
      prepareOutline(outline);
      return outline;
    } catch (error) {
      showLocalError(error.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const open = async ({ courseId, playlistId, origin: nextOrigin = "catalog", trigger, notice = "", outlineData } = {}) => {
    currentCourseId = courseId ?? null;
    currentPlaylistId = playlistId ?? null;
    origin = nextOrigin;
    reviewContext = null;
    opener = trigger ?? root.activeElement;
    if (overlay) overlay.hidden = false;
    body?.classList.add("outline-open");
    if (title) title.textContent = "Загрузка...";
    if (playlistNotice) {
      playlistNotice.textContent = notice;
      playlistNotice.hidden = !notice;
    }
    if (outlineData) {
      setLoading(false);
      hideLocalError();
      prepareOutline(outlineData);
      return outlineData;
    }
    return loadOutline();
  };

  const close = ({ restoreFocus = true } = {}) => {
    if (overlay) overlay.hidden = true;
    body?.classList.remove("outline-open");
    if (restoreFocus) opener?.focus?.();
  };

  const loadReview = async (unitId, lessonCourseId = currentCourseId) => {
    retryAction = () => loadReview(unitId, lessonCourseId);
    hideLocalError();
    setLoading(true);
    try {
      const review = await request(
        `/api/courses/${encodeURIComponent(lessonCourseId)}/review/${encodeURIComponent(unitId)}`,
      );
      reviewOrigin = origin;
      reviewContext = currentPlaylistId
        ? { playlistId: currentPlaylistId, lessonCourseId, origin }
        : { courseId: currentCourseId, origin };
      if (reviewContent) {
        reviewContent.innerHTML = reviewMarkup(review);
        wireArtifactFallbacks(reviewContent);
      }
      close({ restoreFocus: false });
      await onShowReview(review, currentPlaylistId
        ? { ...reviewContext }
        : { courseId: currentCourseId, origin });
      root.querySelector("#review-title")?.focus?.();
      return review;
    } catch (error) {
      showLocalError(error.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (sectionId) => {
    if (expandedSectionIds.has(sectionId)) expandedSectionIds.delete(sectionId);
    else expandedSectionIds.add(sectionId);
    renderOutline();
    root.querySelector(`[data-section-id="${sectionId}"]`)?.focus?.();
  };

  const toggleRoadmapSection = (sectionId) => {
    if (expandedRoadmapSectionIds.has(sectionId)) expandedRoadmapSectionIds.delete(sectionId);
    else expandedRoadmapSectionIds.add(sectionId);
    renderOutline();
    root.querySelector(`[data-roadmap-section-id="${sectionId}"]`)?.focus?.();
  };

  const togglePlaylistLesson = (lessonId) => {
    if (expandedLessonIds.has(lessonId)) expandedLessonIds.delete(lessonId);
    else expandedLessonIds.add(lessonId);
    renderOutline();
    root.querySelector(`[data-lesson-id="${lessonId}"][data-outline-action="toggle-playlist-lesson"]`)?.focus?.();
  };

  const handleClick = (event) => {
    const target = event.target.closest?.(
      "[data-outline-action], [data-action=course-outline], [data-action=lesson-outline]",
    );
    if (!target || target.disabled) return;

    if (target.dataset.action === "course-outline") {
      void open({
        courseId: target.dataset.outlineCourseId,
        origin: "catalog",
        trigger: target,
      });
      return;
    }
    if (target.dataset.action === "lesson-outline") {
      void open({
        courseId: body?.dataset.activePlaylistId ? undefined : body?.dataset.activeCourseId,
        playlistId: body?.dataset.activePlaylistId,
        origin: "lesson",
        trigger: target,
      });
      return;
    }

    const action = target.dataset.outlineAction;
    if (action === "close") close();
    else if (action === "retry") void retryAction?.();
    else if (action === "toggle-section") toggleSection(target.dataset.sectionId);
    else if (action === "toggle-roadmap-section") toggleRoadmapSection(target.dataset.roadmapSectionId);
    else if (action === "toggle-playlist-section") {
      const sectionId = `section:${target.dataset.playlistSectionId}`;
      if (expandedLessonIds.has(sectionId)) expandedLessonIds.delete(sectionId);
      else expandedLessonIds.add(sectionId);
      renderOutline();
      root.querySelector(`[data-playlist-section-id="${sectionId.slice(8)}"]`)?.focus?.();
    }
    else if (action === "toggle-playlist-lesson") togglePlaylistLesson(target.dataset.lessonId);
    else if (action === "open-playlist-lesson" && target.dataset.courseId) {
      close({ restoreFocus: false });
      void onOpenPlaylist(currentPlaylistId, { lessonCourseId: target.dataset.courseId });
    }
    else if (action === "open-playlist-review" && target.dataset.outlineChapterStatus === "completed") {
      void loadReview(target.dataset.unitId, target.dataset.sourceCourseId);
    }
    else if (action === "open-roadmap-item" && target.dataset.courseId) {
      close();
      if (target.dataset.courseId !== currentCourseId || origin === "catalog") {
        void onOpenCurrentCourse(target.dataset.courseId);
      }
    }
    else if (action === "open-unit" && target.dataset.outlineUnitStatus === "completed") {
      void loadReview(target.dataset.unitId);
    } else if (action === "open-unit" && target.dataset.outlineUnitStatus === "current") {
      close();
      if (origin === "catalog") void onOpenCurrentCourse(currentCourseId);
    } else if (action === "return-current") {
      if (reviewContext?.playlistId) {
        void onReturnCurrent(reviewContext.lessonCourseId, { ...reviewContext, origin: reviewOrigin });
      } else {
        void onReturnCurrent(currentCourseId, { origin: reviewOrigin });
      }
    }
  };

  const handleKeydown = (event) => {
    if (overlay?.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableIn(drawer);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && root.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && root.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  root.addEventListener("click", handleClick);
  root.addEventListener("keydown", handleKeydown);

  return {
    open,
    close,
    destroy() {
      root.removeEventListener("click", handleClick);
      root.removeEventListener("keydown", handleKeydown);
    },
  };
}
