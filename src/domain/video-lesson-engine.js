function composeVideoBlock(course, state) {
  const remaining = course.units.slice(Math.max(0, state.cursor));
  const size = Math.min(Math.max(1, state.targetSize), remaining.length);
  return remaining.slice(0, size);
}

function videoError(category, message) {
  return Object.assign(new Error(message), { category });
}

function findUnit(course, id) {
  const unit = course.units.find((candidate) => candidate.id === id);
  if (!unit) throw new Error(`Unknown unit: ${id}`);
  return unit;
}

function findChapter(course, segmentId) {
  const chapter = course.videoSource.chapters.find(
    (candidate) => candidate.id === segmentId || candidate.unitId === segmentId,
  );
  if (!chapter) {
    throw videoError("video-segment-not-found", "Video segment is not found");
  }
  if (chapter.status === "planned") {
    throw videoError("video-segment-planned", "Video segment is not ready");
  }
  return chapter;
}

export function initializeVideoLesson(course, state) {
  if (["video-question-reviewed", "waiting-content", "complete"].includes(state.status)) return state;
  const units = composeVideoBlock(course, state);
  if (units.length === 0) {
    const hasPlanned = course.videoSource?.chapters.some((chapter) => chapter.status === "planned");
    const finalStatus = hasPlanned ? "waiting-content" : "complete";
    return {
      ...state,
      status: finalStatus,
      lifecycleStatus: state.lifecycleStatus === "new" ? finalStatus : state.lifecycleStatus,
      activeUnitIds: [],
      activeQuestionUnitId: null,
    };
  }
  const unitId = units[0].id;
  const questionProgress = {
    ...state.questionProgress,
    [unitId]: state.questionProgress[unitId] ?? { nextQuestionIndex: 0, answers: [] },
  };
  if (state.readingMode) {
    return {
      ...state,
      targetSize: units.length,
      activeUnitIds: [unitId],
      activeQuestionUnitId: unitId,
      status: "video-question-reviewed",
      questionProgress,
    };
  }
  return {
    ...state,
    targetSize: units.length,
    activeUnitIds: [unitId],
    activeQuestionUnitId: unitId,
    status: "awaiting-video-question",
    questionProgress,
  };
}

export function currentVideoQuestion(course, state) {
  const unitId = state.activeQuestionUnitId;
  if (!unitId) return null;
  const unit = findUnit(course, unitId);
  if (!unit.checks) return null;
  const progress = state.questionProgress[unitId];
  if (!progress) return null;
  const question = unit.checks[progress.nextQuestionIndex];
  if (!question) return null;
  const { correct, explanations, ...safe } = question;
  return safe;
}

export function answerVideoQuestion(course, state, questionId, choice, answeredAt) {
  const unitId = state.activeQuestionUnitId;
  if (!unitId) {
    throw videoError("video-question-not-current", "No video question is active");
  }
  const existingProgress = state.questionProgress[unitId];
  if (existingProgress?.answers.some((entry) => entry.questionId === questionId)) {
    throw videoError("video-question-answered", "Video question has already been answered");
  }
  if (state.status !== "awaiting-video-question") {
    throw videoError("video-question-not-current", "Video question is not awaiting an answer");
  }
  const unit = findUnit(course, unitId);
  const progress = state.questionProgress[unitId];
  if (!progress) throw videoError("video-question-not-current", "Question progress is not initialized");

  const questionIndex = progress.nextQuestionIndex;
  const question = unit.checks[questionIndex];
  if (!question) throw videoError("video-question-not-current", "No question is active for this segment");
  if (question.id !== questionId) {
    throw videoError("video-question-not-current", "Question does not match the current question");
  }

  const correct = choice === question.correct;
  const answer = {
    questionId,
    choice,
    correct,
    explanation: question.explanations[choice],
    answeredAt,
  };
  const answers = [...progress.answers, answer];
  const updatedQuestionProgress = {
    ...state.questionProgress,
    [unitId]: { ...progress, answers },
  };
  const answerHistory = [...state.answerHistory, answer];

  return {
    ...state,
    status: "video-question-reviewed",
    questionProgress: updatedQuestionProgress,
    answerHistory,
    updatedAt: answeredAt,
  };
}

export function skipVideoQuestions(course, state, { timestamp } = {}) {
  if (state.status !== "awaiting-video-question") {
    throw videoError("video-questions-not-current", "No video questions to skip");
  }
  const unitId = state.activeQuestionUnitId;
  if (!unitId) {
    throw videoError("video-question-not-current", "No video question is active");
  }
  const unit = findUnit(course, unitId);
  const progress = state.questionProgress[unitId];
  if (!progress) throw videoError("video-question-not-current", "Question progress is not initialized");
  const answered = new Set(progress.answers.map((entry) => entry.questionId));
  const remaining = unit.checks.filter((question) => !answered.has(question.id));
  if (remaining.length === 0) {
    throw videoError("video-questions-not-current", "No unasked questions left in this chapter");
  }
  const skippedAnswers = remaining.map((question) => ({
    questionId: question.id,
    choice: null,
    skipped: true,
    answeredAt: timestamp ?? null,
  }));
  return {
    ...state,
    status: "video-question-reviewed",
    questionProgress: {
      ...state.questionProgress,
      [unitId]: {
        nextQuestionIndex: unit.checks.length,
        answers: [...progress.answers, ...skippedAnswers],
      },
    },
  };
}

export function setVideoReadingMode(course, state, enabled, { timestamp } = {}) {
  const readingMode = Boolean(enabled);
  const next = {
    ...state,
    readingMode,
    readingModeSince: readingMode ? (state.readingModeSince ?? timestamp ?? null) : null,
  };
  if (readingMode && next.status === "awaiting-video-question") {
    return skipVideoQuestions(course, next, { timestamp });
  }
  return next;
}

function finishVideoChapter(course, state, unitId) {
  const newCursor = state.cursor + 1;
  const completedUnitIds = [...new Set([...state.completedUnitIds, unitId])];
  const hasMoreReady = newCursor < course.units.length;

  if (hasMoreReady) {
    return initializeVideoLesson(course, {
      ...state,
      cursor: newCursor,
      completedUnitIds,
      activeUnitIds: [],
      activeQuestionUnitId: null,
      status: "awaiting-video-question",
      questionProgress: state.questionProgress,
    });
  }

  const hasPlanned = course.videoSource?.chapters.some((chapter) => chapter.status === "planned");
  const finalStatus = hasPlanned ? "waiting-content" : "complete";

  return {
    ...state,
    status: finalStatus,
    lifecycleStatus: finalStatus,
    cursor: newCursor,
    completedUnitIds,
    activeUnitIds: [],
    activeQuestionUnitId: null,
    questionProgress: state.questionProgress,
  };
}

export function advanceVideoQuestion(course, state) {
  if (state.status !== "video-question-reviewed") {
    throw new Error("Video question review is required before advancing");
  }
  const unitId = state.activeQuestionUnitId;
  const unit = findUnit(course, unitId);
  if (!state.readingMode) {
    const progress = state.questionProgress[unitId];
    const nextIndex = progress.nextQuestionIndex + 1;
    if (nextIndex < unit.checks.length) {
      return {
        ...state,
        status: "awaiting-video-question",
        questionProgress: {
          ...state.questionProgress,
          [unitId]: { ...progress, nextQuestionIndex: nextIndex },
        },
      };
    }
  }
  return finishVideoChapter(course, state, unitId);
}

export function updateVideoProgress(course, state, segmentId, positionSeconds, updatedAt) {
  const chapter = findChapter(course, segmentId);

  const clamped = Math.max(
    chapter.startSeconds,
    Math.min(chapter.endSeconds, Math.floor(positionSeconds)),
  );
  const watched = clamped >= chapter.endSeconds - 2;
  const previous = state.videoProgress[segmentId];
  const wasWatched = previous?.watched ?? false;

  return {
    ...state,
    videoProgress: {
      ...state.videoProgress,
      [segmentId]: {
        positionSeconds: clamped,
        watched: watched || wasWatched,
        updatedAt,
      },
    },
    updatedAt,
  };
}
