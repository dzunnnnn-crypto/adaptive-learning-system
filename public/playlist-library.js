function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compareDates(left = "", right = "") {
  const leftTime = Date.parse(left) || 0;
  const rightTime = Date.parse(right) || 0;
  return rightTime - leftTime;
}

function progressRatio(course) {
  return Math.max(0, Math.min(1, course.progress ?? 0));
}

function dateDetails(item) {
  const parts = [];
  for (const [label, value] of [["добавлен", item.addedAt], ["занятие", item.updatedAt]]) {
    const date = String(value ?? "").slice(0, 10);
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (match) parts.push(`${label} ${match[3]}.${match[2]}.${match[1]}`);
  }
  return parts.length ? `<span class="course-date-detail">${parts.join(" · ")}</span>` : "";
}

function collectionItems(courses) {
  const collections = new Map();
  const standalone = [];
  for (const course of courses) {
    if (!course.collection?.id) {
      standalone.push({
        kind: "course",
        id: course.id,
        order: course.order,
        addedAt: course.addedAt,
        updatedAt: course.updatedAt,
        progressRatio: progressRatio(course),
        archived: Boolean(course.archived),
        lifecycleStatus: course.lifecycleStatus,
        category: "active",
        value: course,
      });
      continue;
    }
    const group = collections.get(course.collection.id) ?? { collection: course.collection, courses: [] };
    group.courses.push(course);
    collections.set(course.collection.id, group);
  }
  const grouped = [...collections.values()].map(({ collection, courses: groupedCourses }) => {
    const first = groupedCourses.reduce((current, course) => course.order < current.order ? course : current);
    const completed = groupedCourses.reduce((sum, course) => sum + (course.completedUnits ?? 0), 0);
    const total = groupedCourses.reduce((sum, course) => sum + (course.totalUnits ?? 0), 0);
    return {
      kind: "collection",
      id: collection.id,
      order: first.order,
      addedAt: first.addedAt,
      updatedAt: groupedCourses.map(({ updatedAt }) => updatedAt).sort(compareDates)[0] ?? first.updatedAt,
      progressRatio: total ? completed / total : 0,
      archived: false,
      lifecycleStatus: "in-progress",
      category: "active",
      value: { collection, courses: groupedCourses },
    };
  });
  return [...standalone, ...grouped];
}

function sortItems(items, mode, direction) {
  const directionFactor = direction === "asc" ? -1 : 1;
  const compare = (left, right) => {
    let result = 0;
    if (mode === "used") result = compareDates(left.updatedAt, right.updatedAt);
    else if (mode === "progress") result = (right.progressRatio ?? 0) - (left.progressRatio ?? 0);
    else result = compareDates(left.addedAt, right.addedAt);
    return (result || left.order - right.order) * directionFactor;
  };
  return items.sort(compare);
}

export function buildVisibleLibraryItems(payload, { mode = "added", dir = "desc" } = {}) {
  const playlists = payload?.playlists ?? [];
  const childIds = new Set(playlists.flatMap(({ lessonCourseIds = [] }) => lessonCourseIds));
  const courses = (payload?.courses ?? [])
    .filter((course) => !childIds.has(course.id))
    .map((course) => ({ ...course, isLast: course.id === payload?.lastCourseId }));

  const active = collectionItems(courses.filter((course) => !course.archived && course.lifecycleStatus !== "complete"));
  const completed = courses.filter(({ lifecycleStatus }) => lifecycleStatus === "complete")
    .map((course) => ({
      kind: "course", id: course.id, order: course.order, addedAt: course.addedAt, updatedAt: course.updatedAt,
      progressRatio: progressRatio(course), archived: Boolean(course.archived), lifecycleStatus: course.lifecycleStatus,
      category: "completed", value: course,
    }));
  const archived = courses.filter((course) => course.archived && course.lifecycleStatus !== "complete")
    .map((course) => ({
      kind: "course", id: course.id, order: course.order, addedAt: course.addedAt, updatedAt: course.updatedAt,
      progressRatio: progressRatio(course), archived: true, lifecycleStatus: course.lifecycleStatus,
      category: "archived", value: course,
    }));
  const playlistItems = playlists.map((card) => ({
    kind: "youtube-playlist",
    id: card.id,
    order: card.order,
    addedAt: card.addedAt,
    updatedAt: card.updatedAt,
    progressRatio: card.progress?.ratio ?? 0,
    archived: Boolean(card.archived),
    lifecycleStatus: card.lifecycleStatus,
    category: card.lifecycleStatus === "complete" ? "completed" : card.archived ? "archived" : "active",
    value: card,
  }));

  return sortItems([...active, ...completed, ...archived, ...playlistItems], mode, dir);
}

const LIFECYCLE_LABELS = {
  new: "Новый",
  "in-progress": "В процессе",
  "waiting-content": "Ждёт подготовки",
  complete: "Завершён",
  unavailable: "Требует проверки",
};

export function playlistCardMarkup(card, { category = "active" } = {}) {
  const progress = card.progress ?? { completed: 0, total: 0, ratio: 0 };
  const percent = Math.round(Math.max(0, Math.min(1, progress.ratio ?? 0)) * 100);
  const archived = category === "archived" || card.archived;
  const stateLabel = archived ? "В архиве" : LIFECYCLE_LABELS[card.lifecycleStatus] ?? "Требует проверки";
  const current = card.current
    ? `<span class="course-current-detail">Сейчас: ${escapeHtml(card.current.title)}</span>
      <span class="playlist-chapter-detail">Глава ${card.current.chapterNumber} из ${card.current.chapterTotal}</span>`
    : "";
  const preparation = card.current && card.current.readyChapters < card.current.chapterTotal
    ? `<span class="playlist-preparation-detail">Подготовлено ${card.current.readyChapters} из ${card.current.chapterTotal} глав</span>`
    : "";
  const statusMessage = card.navigationError
    ? `<p class="playlist-navigation-error" role="status">${escapeHtml(card.navigationError)}</p>`
    : "";
  const openLabel = card.current ? "Продолжить" : "Открыть оглавление";
  const primaryClass = card.isLast ? "primary-button" : "secondary-button";
  const archiveAction = archived
    ? `<button type="button" class="text-button" data-action="restore-playlist" data-playlist-id="${escapeHtml(card.id)}">Вернуть</button>`
    : `<button type="button" class="text-button" data-action="archive-playlist" data-playlist-id="${escapeHtml(card.id)}">В архив</button>`;
  return `<article class="course-row playlist-row${archived ? " is-archived" : ""}${card.isLast ? " is-last" : ""}" data-playlist-card="${escapeHtml(card.id)}">
    <button type="button" class="course-expand-button playlist-outline-button" data-action="playlist-outline" data-playlist-id="${escapeHtml(card.id)}" aria-label="Открыть оглавление плейлиста ${escapeHtml(card.title)}"><span aria-hidden="true">›</span></button>
    <div class="course-row-content">
      <div class="course-row-title-line"><h3>${escapeHtml(card.title)}</h3><span class="course-state">${escapeHtml(stateLabel)}</span></div>
      <div class="course-row-meta">${current}${preparation}${dateDetails(card)}</div>
      <div class="course-row-source"><a class="course-source-link" href="${escapeHtml(card.sourceUrl)}" target="_blank" rel="noreferrer">YouTube · оригинал</a><span class="course-source-detail">${escapeHtml(card.author)}</span></div>
      ${statusMessage}
    </div>
    <div class="course-row-progress playlist-progress" data-playlist-progress aria-label="Прогресс плейлиста">
      <span>Пройдено уроков: ${progress.completed} из ${progress.total}</span>
      <span class="course-progress-track" aria-hidden="true"><span style="width: ${percent}%"></span></span>
      <span>${percent}%</span>
    </div>
    <div class="course-row-actions">
      <button type="button" class="${primaryClass}" data-action="open-playlist" data-playlist-id="${escapeHtml(card.id)}">${openLabel}</button>
      ${archiveAction}
    </div>
  </article>`;
}
