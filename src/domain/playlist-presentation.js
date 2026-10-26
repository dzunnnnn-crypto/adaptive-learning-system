import { API_VERSION, APP_ID } from "../app-identity.js";

function snapshotFor(item, lessonSnapshots) {
  if (!item.courseId) return { status: "planned", snapshot: null };
  const snapshot = lessonSnapshots.get(item.courseId);
  if (!snapshot || snapshot.availability === "unavailable") {
    return {
      status: "unavailable",
      snapshot: null,
      reason: snapshot?.reason ?? "Материалы урока недоступны для проверки.",
    };
  }

  const chapters = snapshot.chapters ?? [];
  const ready = chapters.filter(({ status }) => status !== "planned");
  const planned = chapters.length - ready.length;
  const completedIds = new Set(snapshot.completedUnitIds ?? []);
  const allReadyCompleted = ready.length > 0
    && ready.every(({ unitId }) => unitId && completedIds.has(unitId));

  if (planned === 0 && ready.length === chapters.length && allReadyCompleted) {
    return { status: "completed", snapshot };
  }
  if (planned > 0 && allReadyCompleted) return { status: "waiting-content", snapshot };
  if (planned > 0 && ready.length > 0) return { status: "partial", snapshot };
  if (ready.length === chapters.length && ready.length > 0) return { status: "prepared", snapshot };
  return {
    status: "unavailable",
    snapshot: null,
    reason: "Состав подготовленных глав не удалось проверить.",
  };
}

function latestDate(values) {
  return values.filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .reduce((latest, value) => !latest || Date.parse(value) > Date.parse(latest) ? value : latest, null);
}

function routeItems(roadmap) {
  return roadmap.sections.flatMap((section) => section.items.map((item) => ({
    ...item,
    sectionId: section.id,
    sectionTitle: section.title,
  })));
}

function latestUsedFallback(items, lessonStatuses) {
  return items
    .filter((item) => {
      const status = lessonStatuses.get(item.id);
      return item.courseId
        && status?.snapshot?.hasLearningActivity
        && status.status !== "completed"
        && status.status !== "unavailable";
    })
    .sort((left, right) => {
      const leftDate = lessonStatuses.get(left.id).snapshot.updatedAt ?? "";
      const rightDate = lessonStatuses.get(right.id).snapshot.updatedAt ?? "";
      const instantDifference = (Date.parse(rightDate) || 0) - (Date.parse(leftDate) || 0);
      return instantDifference || left.order - right.order;
    })[0]?.courseId ?? null;
}

function chooseResumeCourseId({ items, lessonStatuses, navigation, globalLastCourseId }) {
  const byCourseId = new Map(items.filter(({ courseId }) => courseId).map((item) => [item.courseId, item]));
  if (navigation?.lastLessonCourseId) {
    const item = byCourseId.get(navigation.lastLessonCourseId);
    if (!item) {
      return { courseId: null, error: "Последний выбранный урок больше не входит в этот плейлист." };
    }
    const status = lessonStatuses.get(item.id)?.status;
    if (status === "unavailable") {
      return { courseId: null, error: lessonStatuses.get(item.id)?.reason ?? "Последний выбранный урок недоступен." };
    }
    if (status === "planned") {
      return { courseId: null, error: "Последний выбранный урок ещё не подготовлен." };
    }
    return { courseId: status === "completed" ? null : item.courseId, error: null };
  }

  if (globalLastCourseId && byCourseId.has(globalLastCourseId)) {
    const item = byCourseId.get(globalLastCourseId);
    const status = lessonStatuses.get(item.id)?.status;
    if (status === "unavailable" || status === "planned" || status === "completed") {
      return { courseId: null, error: status === "unavailable"
        ? lessonStatuses.get(item.id)?.reason ?? "Последний открытый урок недоступен."
        : null };
    }
    return { courseId: item.courseId, error: null };
  }

  return { courseId: latestUsedFallback(items, lessonStatuses), error: null };
}

function currentLesson(item, snapshot, status) {
  if (!item || !snapshot || status === "completed" || status === "unavailable" || status === "planned") return null;
  const chapters = snapshot.chapters ?? [];
  const ready = chapters.filter(({ status: chapterStatus }) => chapterStatus !== "planned");
  const activeIds = new Set(snapshot.activeUnitIds ?? []);
  let chapter = ready.find(({ unitId }) => activeIds.has(unitId));
  if (!chapter) {
    const cursor = Math.max(0, Number.isInteger(snapshot.cursor) ? snapshot.cursor : 0);
    chapter = ready[cursor] ?? chapters.find(({ status: chapterStatus }) => chapterStatus === "planned") ?? null;
  }
  if (!chapter) return null;
  return {
    courseId: item.courseId,
    title: item.title,
    chapterNumber: chapter.order,
    chapterTotal: chapters.length,
    readyChapters: ready.length,
  };
}

function lessonOutline(item, lessonStatus, resumeCourseId) {
  const { status, snapshot, reason } = lessonStatus;
  const chapters = (snapshot?.chapters ?? []).map((chapter) => {
    if (chapter.status === "planned") {
      return { id: chapter.id, title: chapter.title, order: chapter.order, status: "planned" };
    }
    const completed = new Set(snapshot.completedUnitIds ?? []);
    const active = new Set(snapshot.activeUnitIds ?? []);
    return {
      id: chapter.id,
      unitId: chapter.unitId,
      title: chapter.title,
      order: chapter.order,
      status: completed.has(chapter.unitId)
        ? "completed"
        : active.has(chapter.unitId)
          ? "current"
          : "locked",
    };
  });
  const ready = chapters.filter(({ status: chapterStatus }) => chapterStatus !== "planned").length;
  return {
    id: item.id,
    title: item.title,
    order: item.order,
    ...(item.courseId ? { courseId: item.courseId } : {}),
    status,
    isCurrent: item.courseId === resumeCourseId,
    ...(reason ? { reason } : {}),
    ...(snapshot ? { chapterPreparation: { ready, total: chapters.length } } : {}),
    chapters,
  };
}

export function buildPlaylistPresentation({
  roadmap,
  lessonSnapshots,
  catalogEntries,
  navigation,
  globalLastCourseId,
  navigationError = null,
}) {
  const items = routeItems(roadmap);
  const lessonStatuses = new Map(items.map((item) => [item.id, snapshotFor(item, lessonSnapshots)]));
  const chosen = navigationError
    ? { courseId: null, error: navigationError.message ?? String(navigationError) }
    : chooseResumeCourseId({ items, lessonStatuses, navigation, globalLastCourseId });
  const progress = {
    completed: [...lessonStatuses.values()].filter(({ status }) => status === "completed").length,
    total: items.length,
    prepared: [...lessonStatuses.values()].filter(({ status }) => ["prepared", "completed"].includes(status)).length,
    partial: [...lessonStatuses.values()].filter(({ status }) => ["partial", "waiting-content"].includes(status)).length,
  };
  progress.ratio = progress.total === 0 ? 0 : progress.completed / progress.total;

  const currentItem = items.find(({ courseId }) => courseId === chosen.courseId);
  const current = currentLesson(
    currentItem,
    currentItem ? lessonStatuses.get(currentItem.id).snapshot : null,
    currentItem ? lessonStatuses.get(currentItem.id).status : null,
  );
  const hasUnavailable = [...lessonStatuses.values()].some(({ status }) => status === "unavailable");
  const allCompleted = progress.total > 0 && progress.completed === progress.total;
  const hasActivity = [...lessonStatuses.values()].some(({ snapshot }) => snapshot?.hasLearningActivity)
    || Boolean(navigation?.lastOpenedAt)
    || Boolean(globalLastCourseId && items.some(({ courseId }) => courseId === globalLastCourseId));
  const hasPreparedIncomplete = [...lessonStatuses.values()].some(({ status }) => status === "prepared" || status === "partial");
  const lifecycleStatus = allCompleted
    ? "complete"
    : hasUnavailable
      ? "unavailable"
      : !hasActivity
        ? "new"
        : hasPreparedIncomplete
          ? "in-progress"
          : "waiting-content";
  const linkedOrders = catalogEntries
    .filter(({ id }) => items.some(({ courseId }) => courseId === id))
    .map(({ order }) => order);
  const maximumCatalogOrder = Math.max(0, ...catalogEntries.map(({ order }) => order));
  const order = linkedOrders.length ? Math.min(...linkedOrders) : maximumCatalogOrder + 1;
  const updatedAt = latestDate([
    navigation?.lastOpenedAt,
    ...[...lessonStatuses.values()].map(({ snapshot }) => snapshot?.updatedAt),
  ]);
  const card = {
    kind: "youtube-playlist",
    id: roadmap.id,
    title: roadmap.title,
    author: roadmap.author,
    sourceUrl: roadmap.sourceUrl,
    addedAt: roadmap.addedAt,
    order,
    updatedAt,
    archived: navigation?.archived ?? false,
    lifecycleStatus,
    isLast: order === maximumCatalogOrder,
    lessonCourseIds: items.flatMap(({ courseId }) => courseId ? [courseId] : []),
    progress,
    current,
    navigationError: chosen.error,
  };
  const outline = {
    appId: APP_ID,
    apiVersion: API_VERSION,
    playlistId: roadmap.id,
    title: roadmap.title,
    progress,
    currentCourseId: chosen.courseId,
    navigationError: chosen.error,
    sections: roadmap.sections.map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
      lessons: section.items.map((item) => lessonOutline(
        item,
        lessonStatuses.get(item.id),
        chosen.courseId,
      )),
    })),
  };
  return { card, outline, resumeCourseId: chosen.courseId };
}
