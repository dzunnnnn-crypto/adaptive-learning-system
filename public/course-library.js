import { buildVisibleLibraryItems, playlistCardMarkup } from "./playlist-library.js";

const LIFECYCLE_LABELS = {
  new: "Новый",
  "in-progress": "В процессе",
  "waiting-content": "Ждёт следующую главу",
  paused: "На паузе",
  complete: "Завершён",
};

const OUTLINE_STATUS = {
  completed: { symbol: "✓", label: "пройдено" },
  current: { symbol: "●", label: "следующий" },
  available: { symbol: "○", label: "готово" },
  locked: { symbol: "○", label: "ещё не открыто" },
  planned: { symbol: "○", label: "запланировано" },
  unavailable: { symbol: "!", label: "недоступно" },
};

const MAX_INLINE_UNITS = 5;

const COURSE_SORT_STORAGE_KEY = "courseSortMode";
const COURSE_SORT_DIR_KEY = "courseSortDir";

function compareDateDesc(first = "", second = "") {
  if (first === second) return 0;
  return first < second ? 1 : -1;
}

const COURSE_SORTS = {
  added: (a, b) => compareDateDesc(a.addedAt, b.addedAt) || a.order - b.order,
  used: (a, b) => compareDateDesc(a.updatedAt, b.updatedAt) || a.order - b.order,
  progress: (a, b) => (b.progress ?? 0) - (a.progress ?? 0) || a.order - b.order,
};

const COURSE_SORT_LABELS = {
  added: "По дате добавления",
  used: "По последнему использованию",
  progress: "По степени пройденности",
};

export function getCourseSort() {
  try {
    const stored = localStorage.getItem(COURSE_SORT_STORAGE_KEY);
    const mode = stored && stored in COURSE_SORTS ? stored : "added";
    const dir = localStorage.getItem(COURSE_SORT_DIR_KEY) === "asc" ? "asc" : "desc";
    return { mode, dir };
  } catch {
    return { mode: "added", dir: "desc" };
  }
}

export function toggleCourseSort(mode) {
  if (!(mode in COURSE_SORTS)) return;
  const { mode: currentMode, dir: currentDir } = getCourseSort();
  try {
    localStorage.setItem(COURSE_SORT_STORAGE_KEY, mode);
    if (currentMode === mode) {
      localStorage.setItem(COURSE_SORT_DIR_KEY, currentDir === "asc" ? "desc" : "asc");
    } else {
      localStorage.setItem(COURSE_SORT_DIR_KEY, "desc");
    }
  } catch {
    // localStorage недоступен: направление применится только до перезагрузки
  }
}

function formatDate(value) {
  const datePart = String(value ?? "").slice(0, 10);
  const [year, month, day] = datePart.split("-");
  return day && month && year ? `${day}.${month}.${year}` : "";
}

function isTrackedDate(value) {
  return Boolean(value) && Date.parse(value) > 0;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function courseIdFromPath(pathname) {
  const match = pathname.match(/^\/course\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/u);
  return match?.[1] ?? null;
}

export function coursePath(courseId) {
  return `/course/${encodeURIComponent(courseId)}`;
}

function progressPercent(course) {
  return Math.round(Math.max(0, Math.min(1, course.progress ?? 0)) * 100);
}

function progressMarkup(course) {
  const percent = progressPercent(course);
  return `<div class="course-row-progress" aria-label="Прогресс курса">
    <span>${course.completedUnits ?? 0} из ${course.totalUnits ?? 0}</span>
    <span class="course-progress-track" aria-hidden="true"><span style="width: ${percent}%"></span></span>
    <span>${percent}%</span>
  </div>`;
}

function sourceMarkup(course) {
  const source = course.source;
  if (!source) return "";
  const author = source.author ?? "автор не указан";
  return `<a class="course-source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.kind)} · оригинал</a>
    <span class="course-source-detail">${escapeHtml(author)}</span>`;
}

function collectionLabel(course) {
  const collection = course.collection;
  if (!collection) return "";
  const chapter = collection.itemTitle?.replace(/^Глава\s+\d+\.\s*/u, "") ?? course.title;
  const number = collection.itemTitle?.match(/^Глава\s+(\d+)/u)?.[1];
  return `<span class="course-collection-detail">${number ? `Глава ${number} · ` : ""}${escapeHtml(chapter)}</span>`;
}

function courseDates(course) {
  const parts = [];
  if (isTrackedDate(course.addedAt)) parts.push(`добавлен ${formatDate(course.addedAt)}`);
  if (isTrackedDate(course.updatedAt)) parts.push(`занятие ${formatDate(course.updatedAt)}`);
  return parts.length ? `<span class="course-date-detail">${parts.join(" · ")}</span>` : "";
}

function nextChapter(courses) {
  return courses.find((course) => (
    course.lifecycleStatus !== "complete" && course.availability === "available"
  )) ?? null;
}

function collectionProgress(courses) {
  const completed = courses.reduce((sum, course) => sum + (course.completedUnits ?? 0), 0);
  const total = courses.reduce((sum, course) => sum + (course.totalUnits ?? 0), 0);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent };
}

function courseRow(course, { archived = false, collection = false } = {}) {
  const available = course.availability === "available";
  const action = course.lifecycleStatus === "in-progress" ? "Продолжить" : "Открыть";
  const label = archived ? "В архиве" : (LIFECYCLE_LABELS[course.lifecycleStatus] ?? "Готов");
  const current = course.currentTitle
    ? `<span class="course-current-detail">Сейчас: ${escapeHtml(course.currentTitle)}</span>`
    : "";
  const disabled = available ? "" : " disabled";
  return `<article class="course-row${archived ? " is-archived" : ""}${course.isLast ? " is-last" : ""}" data-course-card="${escapeHtml(course.id)}">
    <button type="button" class="course-expand-button" data-action="toggle-inline-outline" data-course-id="${escapeHtml(course.id)}" aria-expanded="false"${disabled} aria-label="Показать содержание курса">
      <span aria-hidden="true">›</span>
    </button>
    <div class="course-row-content">
      <div class="course-row-title-line">
        <h3>${escapeHtml(course.title)}</h3>
        <span class="course-state">${escapeHtml(course.isLast ? "Последний курс" : label)}</span>
      </div>
      <div class="course-row-meta">
        ${collection ? collectionLabel(course) : ""}
        ${current}
        ${courseDates(course)}
      </div>
      <div class="course-row-source">${sourceMarkup(course)}</div>
      <div class="inline-outline" data-inline-outline hidden></div>
    </div>
    ${available ? progressMarkup(course) : `<span class="course-unavailable">${escapeHtml(course.message ?? "Курс требует проверки.")}</span>`}
    <div class="course-row-actions">
      <button type="button" class="${course.isLast ? "primary-button" : "secondary-button"}" data-action="${course.isLast ? "continue-course" : "open-course"}" data-course-id="${escapeHtml(course.id)}"${disabled}>${course.isLast ? "Продолжить" : action}</button>
      ${archived
        ? `<button type="button" class="text-button" data-action="restore-course" data-course-id="${escapeHtml(course.id)}">Вернуть</button>`
        : `<button type="button" class="text-button" data-action="archive-course" data-course-id="${escapeHtml(course.id)}">В архив</button>`}
    </div>
  </article>`;
}

function collectionMarkup(collection, courses) {
  const first = courses[0];
  const source = first?.source;
  const author = source?.author ?? "автор не указан";
  const kind = source?.kind ?? "источник";
  const next = nextChapter(courses);
  const progress = collectionProgress(courses);
  const hasCurrent = courses.some((course) => course.isLast);
  const chapters = courses.map((course) => {
    const status = OUTLINE_STATUS[course.lifecycleStatus === "complete" ? "completed" : course.isLast ? "current" : "available"] ?? OUTLINE_STATUS.available;
    return `<button type="button" class="inline-outline-unit is-course is-${course.lifecycleStatus === "complete" ? "completed" : course.isLast ? "current" : "available"}" data-action="open-course" data-course-id="${escapeHtml(course.id)}">
      <span class="inline-outline-mark" aria-hidden="true">${status.symbol}</span>
      <span class="inline-outline-title">${escapeHtml(course.title)}</span>
      <span class="inline-outline-status">${escapeHtml(status.label)}</span>
    </button>`;
  }).join("");
  return `<section class="course-collection" data-collection-id="${escapeHtml(collection.id)}">
    <div class="course-row collection-row">
      <button type="button" class="course-expand-button collection-outline-toggle" data-action="toggle-collection-outline" data-collection-id="${escapeHtml(collection.id)}" aria-expanded="false" aria-controls="${escapeHtml(collection.id)}-outline" aria-label="Показать главы курса">
        <span class="disclosure-mark" aria-hidden="true">›</span>
      </button>
      <div class="course-row-content">
        <div class="course-row-title-line">
        <h3>${escapeHtml(collection.title)}</h3>
          <span class="course-state">Главы · ${courses.length}</span>
        </div>
        <div class="course-row-meta">
          ${next?.currentTitle ? `<span class="course-current-detail">Сейчас: ${escapeHtml(next.currentTitle)}</span>` : ""}
        </div>
        <div class="course-row-source">
          ${source ? `<a class="course-source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(kind)} · оригинал</a>` : ""}
          <span class="course-source-detail">${escapeHtml(author)}</span>
        </div>
      </div>
      <div class="course-row-progress" aria-label="Прогресс курса">
        <span>${progress.completed} из ${progress.total}</span>
        <span class="course-progress-track" aria-hidden="true"><span style="width: ${progress.percent}%"></span></span>
        <span>${progress.percent}%</span>
      </div>
      <div class="course-row-actions">
      <button type="button" class="${hasCurrent ? "primary-button" : "secondary-button"}" data-action="${next ? "open-course" : ""}"${next ? ` data-course-id="${escapeHtml(next.id)}"` : ""}${next ? "" : " disabled"}>${hasCurrent ? "Продолжить" : "Открыть"}</button>
      </div>
    </div>
    <div class="inline-outline" id="${escapeHtml(collection.id)}-outline" data-collection-outline hidden>${chapters}</div>
  </section>`;
}

function archivedCourseRow(course) {
  return `<div class="archived-course-row" data-course-card="${escapeHtml(course.id)}">
    <span class="archived-course-title">${escapeHtml(course.title)}</span>
    <span class="archived-course-progress">${course.completedUnits ?? 0} из ${course.totalUnits ?? 0}</span>
    <button type="button" class="text-button" data-action="restore-course" data-course-id="${escapeHtml(course.id)}">Вернуть</button>
  </div>`;
}

function completedCourseRow(course) {
  const action = course.archived
    ? `<button type="button" class="text-button" data-action="restore-course" data-course-id="${escapeHtml(course.id)}">Вернуть</button>`
    : `<button type="button" class="text-button" data-action="archive-course" data-course-id="${escapeHtml(course.id)}">В архив</button>`;
  return `<div class="archived-course-row is-completed" data-course-card="${escapeHtml(course.id)}">
    <span class="archived-course-title"><span class="completed-mark" aria-hidden="true">✓</span> ${escapeHtml(course.title)}</span>
    <span class="archived-course-progress">${course.completedUnits ?? 0} из ${course.totalUnits ?? 0} · пройден${isTrackedDate(course.updatedAt) ? ` · ${formatDate(course.updatedAt)}` : ""}</span>
    ${action}
  </div>`;
}

function renderLibraryItem(item) {
  if (item.kind === "youtube-playlist") {
    return playlistCardMarkup(item.value, { category: item.category });
  }
  if (item.kind === "collection") {
    return collectionMarkup(item.value.collection, item.value.courses);
  }
  if (item.category === "completed") return completedCourseRow(item.value);
  if (item.category === "archived") return archivedCourseRow(item.value);
  return courseRow(item.value);
}

function outlineUnits(outline) {
  return (outline?.sections ?? []).flatMap((section) => (
    (section.units ?? []).map((unit) => ({ ...unit, sectionTitle: section.title }))
  ));
}

function outlineMarkup(outline, showAll = false) {
  const units = outlineUnits(outline);
  const visibleUnits = showAll ? units : units.slice(0, MAX_INLINE_UNITS);
  const rows = visibleUnits.map((unit) => {
    const status = OUTLINE_STATUS[unit.status] ?? OUTLINE_STATUS.locked;
    return `<div class="inline-outline-unit is-${escapeHtml(unit.status)}">
      <span class="inline-outline-mark" aria-hidden="true">${status.symbol}</span>
      <span class="inline-outline-title">${escapeHtml(unit.title)}</span>
      <span class="inline-outline-status">${escapeHtml(status.label)}</span>
    </div>`;
  }).join("");
  const more = units.length > MAX_INLINE_UNITS
    ? `<button type="button" class="inline-outline-more" data-action="expand-inline-outline">${showAll ? "Свернуть содержание" : `Показать все ${units.length} пунктов`}</button>`
    : "";
  return `<div class="inline-outline-heading"><span>Содержание</span><span>${outline?.progress?.completed ?? 0} из ${outline?.progress?.total ?? units.length}</span></div>
    ${rows || '<p class="inline-outline-empty">Содержание пока недоступно.</p>'}
    ${more}`;
}

export function renderInlineOutline(panel, outline, showAll = false) {
  panel.innerHTML = outlineMarkup(outline, showAll);
  panel.dataset.outlineLoaded = "true";
  panel.dataset.outlineExpanded = showAll ? "true" : "false";
}

export function rerenderInlineOutline(panel, outline) {
  renderInlineOutline(panel, outline, panel.dataset.outlineExpanded === "true");
}

export function renderCatalog(payload, root = document) {
  const { mode: sortMode, dir: sortDir } = getCourseSort();
  const libraryItems = buildVisibleLibraryItems(payload, { mode: sortMode, dir: sortDir });
  const activeItems = libraryItems.filter((item) => item.category === "active");
  const completedItems = libraryItems.filter((item) => item.category === "completed");
  const archivedItems = libraryItems.filter((item) => item.category === "archived");
  const continuePanel = root.querySelector("[data-role=continue-panel]");
  if (continuePanel) {
    continuePanel.hidden = true;
    continuePanel.innerHTML = "";
  }
  const heading = root.querySelector("#all-courses-title");
  if (heading) {
    heading.textContent = `Все курсы · ${activeItems.length} активных · ${completedItems.length} пройденных · ${archivedItems.length} в архиве`;
  }
  root.querySelectorAll("[data-action=sort-courses]").forEach((button) => {
    const isActive = button.dataset.sort === sortMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
    const label = COURSE_SORT_LABELS[button.dataset.sort] ?? button.dataset.sort;
    button.textContent = isActive ? `${label} ${sortDir === "asc" ? "↑" : "↓"}` : label;
  });
  const grid = root.querySelector("[data-role=course-grid]");
  if (grid) grid.innerHTML = activeItems.map(renderLibraryItem).join("");
  const completedSection = root.querySelector("[data-role=completed-section]");
  const completedGrid = root.querySelector("[data-role=completed-grid]");
  if (completedGrid) {
    completedGrid.innerHTML = completedItems.map(renderLibraryItem).join("");
    completedGrid.hidden = true;
  }
  const completedCount = root.querySelector("[data-role=completed-count]");
  if (completedCount) completedCount.textContent = String(completedItems.length);
  const completedToggle = root.querySelector("[data-action=toggle-completed]");
  if (completedToggle) completedToggle.setAttribute("aria-expanded", "false");
  if (completedSection) completedSection.hidden = completedItems.length === 0;
  const archivedSection = root.querySelector("[data-role=archived-section]");
  const archivedGrid = root.querySelector("[data-role=archived-grid]");
  if (archivedGrid) {
    archivedGrid.innerHTML = archivedItems.map(renderLibraryItem).join("");
    archivedGrid.hidden = true;
  }
  const archiveCount = root.querySelector("[data-role=archive-count]");
  if (archiveCount) archiveCount.textContent = String(archivedItems.length);
  const archiveToggle = root.querySelector("[data-action=toggle-archive]");
  if (archiveToggle) archiveToggle.setAttribute("aria-expanded", "false");
  if (archivedSection) archivedSection.hidden = archivedItems.length === 0;
  const empty = root.querySelector("[data-role=catalog-empty]");
  if (empty) empty.hidden = activeItems.length > 0;
}
