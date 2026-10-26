import {
  compactContextChanges,
  createClarificationThread,
} from "./clarification-thread.js";

function normalizeTargetSize(value) {
  return Math.max(1, Number.isInteger(value) ? value : 1);
}

function createArticleInitialState(course, { cursor = 0, targetSize = 1 } = {}) {
  return {
    version: 4,
    courseId: course.id,
    contentVersion: course.contentVersion,
    lifecycleStatus: "new",
    cursor: Math.max(0, cursor),
    targetSize: normalizeTargetSize(targetSize),
    activeUnitIds: [],
    activeQuestionUnitIds: [],
    activeQuestionIndex: 0,
    activeQuestionUnitId: null,
    status: "awaiting-answer",
    answer: null,
    answerHistory: [],
    layers: [],
    practice: null,
    askedQuestionIds: [],
    skippedQuestionIds: [],
    readingMode: false,
    readingModeSince: null,
    completedUnitIds: [],
    applicationChoice: null,
    practiceHistory: [],
    activityHistory: [],
    clarificationThread: createClarificationThread(course.id, Math.max(0, cursor)),
    clarificationHistory: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeArticleLearningState(state, course) {
  const compatible = state.version === 4
    && state.courseId === course.id
    && state.contentVersion === course.contentVersion;
  if (!compatible) {
    throw new Error("Learning state is incompatible with the active course");
  }

  const defaults = createInitialState(course, {
    cursor: state.cursor ?? 0,
    targetSize: state.targetSize ?? 1,
  });
  const activeUnitIds = [...new Set(state.activeUnitIds ?? [])];
  const activeIds = new Set(activeUnitIds);
  const questionUnitIds = state.activeQuestionUnitIds?.length
    ? state.activeQuestionUnitIds
    : Array.isArray(state.activeQuestionUnitIds)
      ? []
      : activeUnitIds;
  const activeQuestionUnitIds = [...new Set(questionUnitIds)]
    .filter((id) => activeIds.has(id));
  const legacyQuestionIndex = state.activeQuestionUnitId
    ? activeQuestionUnitIds.indexOf(state.activeQuestionUnitId)
    : -1;
  const firstUnaskedQuestionIndex = activeQuestionUnitIds.findIndex(
    (id) => !(state.askedQuestionIds ?? []).includes(id),
  );
  const requestedQuestionIndex = Number.isInteger(state.activeQuestionIndex)
    ? state.activeQuestionIndex
    : state.status === "awaiting-answer" && firstUnaskedQuestionIndex >= 0
      ? firstUnaskedQuestionIndex
      : legacyQuestionIndex;
  const activeQuestionIndex = Math.max(
    0,
    Math.min(requestedQuestionIndex, Math.max(0, activeQuestionUnitIds.length - 1)),
  );
  const completedUnitIds = [...new Set(state.completedUnitIds ?? [])]
    .filter((id) => !activeIds.has(id));
  return {
    ...defaults,
    ...state,
    version: 4,
    courseId: course.id,
    contentVersion: course.contentVersion,
    targetSize: normalizeTargetSize(state.targetSize),
    lifecycleStatus: state.lifecycleStatus ?? "new",
    activeUnitIds,
    activeQuestionUnitIds,
    activeQuestionIndex,
    activeQuestionUnitId: activeQuestionUnitIds[activeQuestionIndex] ?? null,
    completedUnitIds,
    activityHistory: state.activityHistory ?? [],
    clarificationThread: compactContextChanges(
      state.clarificationThread
        ?? createClarificationThread(course.id, state.cursor ?? 0),
    ),
    clarificationHistory: state.clarificationHistory ?? [],
  };
}

function createVideoInitialState(course, { cursor = 0, targetSize = 1 } = {}) {
  return {
    ...createArticleInitialState(course, { cursor, targetSize }),
    version: 5,
    status: "awaiting-video-question",
    videoProgress: {},
    questionProgress: {},
  };
}

function normalizeVideoLearningState(state, course) {
  const compatible = state.version === 5
    && state.courseId === course.id
    && state.contentVersion === course.contentVersion;
  if (!compatible) {
    throw new Error("Learning state is incompatible with the active course");
  }
  const defaults = createVideoInitialState(course, {
    cursor: state.cursor ?? 0,
    targetSize: state.targetSize ?? 1,
  });
  return {
    ...defaults,
    ...state,
    version: 5,
    courseId: course.id,
    contentVersion: course.contentVersion,
    targetSize: normalizeTargetSize(state.targetSize),
    videoProgress: state.videoProgress ?? {},
    questionProgress: state.questionProgress ?? {},
    completedUnitIds: [...new Set(state.completedUnitIds ?? [])],
  };
}

export function createInitialState(course, options = {}) {
  return course.schemaVersion === 7
    ? createVideoInitialState(course, options)
    : createArticleInitialState(course, options);
}

export function normalizeLearningState(state, course) {
  return course.schemaVersion === 7
    ? normalizeVideoLearningState(state, course)
    : normalizeArticleLearningState(state, course);
}
