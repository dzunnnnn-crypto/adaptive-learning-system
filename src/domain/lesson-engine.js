import { initializeVideoLesson } from "./video-lesson-engine.js";

function remainingUnits(course, cursor) {
  return course.units.slice(Math.max(0, cursor));
}

function normalizeSize(course, cursor, requestedSize) {
  const remaining = remainingUnits(course, cursor).length;
  if (remaining === 0) return 0;
  return Math.min(Math.max(1, requestedSize), remaining);
}

function sameIds(left = [], right = []) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function composeBlock(course, state) {
  const actualSize = normalizeSize(course, state.cursor, state.targetSize);
  const units = remainingUnits(course, state.cursor).slice(0, actualSize);
  return {
    unitIds: units.map((unit) => unit.id),
    units,
    actualSize: units.length,
    boundaryReached: units.length === remainingUnits(course, state.cursor).length,
  };
}

export function resizeBlock(course, state, delta) {
  if (![1, -1].includes(delta)) throw new Error("Resize delta must be 1 or -1");
  if (state.status !== "awaiting-answer" && !(state.readingMode && state.status === "reviewed")) {
    throw new Error("Block size can only change before answer review");
  }

  const current = composeBlock(course, state);
  const requestedSize = current.actualSize + delta;
  const nextSize = normalizeSize(course, state.cursor, requestedSize);
  if (nextSize === current.actualSize) return state;

  const composed = composeBlock(course, { ...state, targetSize: nextSize });
  const merged = {
    ...state,
    targetSize: composed.actualSize,
    activeUnitIds: composed.unitIds,
    answer: null,
    layers: [],
    practice: null,
    status: "awaiting-answer",
  };
  if (state.readingMode) {
    return {
      ...merged,
      status: "reviewed",
      activeQuestionUnitIds: [],
      activeQuestionIndex: 0,
      activeQuestionUnitId: null,
    };
  }
  return initializeQuestionQueue(merged, composed.unitIds);
}

function findUnit(course, id) {
  const unit = course.units.find((candidate) => candidate.id === id);
  if (!unit) throw new Error(`Unknown unit: ${id}`);
  return unit;
}

function activeQuestionUnitIds(state) {
  return Array.isArray(state.activeQuestionUnitIds)
    ? state.activeQuestionUnitIds
    : state.activeUnitIds;
}

function initializeQuestionQueue(state, unitIds) {
  return {
    ...state,
    activeQuestionUnitIds: unitIds,
    activeQuestionIndex: 0,
    activeQuestionUnitId: unitIds[0] ?? null,
  };
}

function nextUnaskedQuestionIndex(state) {
  const questionUnitIds = activeQuestionUnitIds(state);
  const asked = new Set(state.askedQuestionIds ?? []);
  const afterCurrent = questionUnitIds.findIndex(
    (id, index) => index > state.activeQuestionIndex && !asked.has(id),
  );
  if (afterCurrent >= 0) return afterCurrent;
  return questionUnitIds.findIndex((id) => !asked.has(id));
}

export function completePreparedActivity(course, state, { unitId, result, completedAt }) {
  if (!["awaiting-answer", "reviewed"].includes(state.status)) {
    throw new Error("Activity is not available in the current lesson state");
  }
  if (!state.activeUnitIds.includes(unitId)) {
    throw new Error("Activity unit is not active");
  }
  const unit = findUnit(course, unitId);
  if (!unit.activity) throw new Error("Unit has no prepared activity");
  const cleaned = String(result ?? "").trim();
  if (!cleaned) throw new Error("Activity result is required");
  const entry = { unitId, result: cleaned, completedAt };
  return {
    ...state,
    activityHistory: [
      ...(state.activityHistory ?? []).filter((candidate) => candidate.unitId !== unitId),
      entry,
    ],
  };
}

export function initializeActiveBlock(course, state) {
  if (course.schemaVersion === 7) {
    return initializeVideoLesson(course, state);
  }
  if (["reviewed", "awaiting-application", "complete"].includes(state.status)) return state;
  const composed = composeBlock(course, state);
  if (
    state.status === "awaiting-answer"
    && sameIds(state.activeUnitIds, composed.unitIds)
    && sameIds(activeQuestionUnitIds(state), composed.unitIds)
  ) {
    return state;
  }
  if (state.readingMode) {
    return {
      ...state,
      targetSize: composed.actualSize || 1,
      activeUnitIds: composed.unitIds,
      status: composed.unitIds.length === 0 ? "complete" : "reviewed",
      activeQuestionUnitIds: [],
      activeQuestionIndex: 0,
      activeQuestionUnitId: null,
    };
  }
  return initializeQuestionQueue({
    ...state,
    targetSize: composed.actualSize || 1,
    activeUnitIds: composed.unitIds,
    status: composed.unitIds.length === 0 ? "complete" : "awaiting-answer",
  }, composed.unitIds);
}

export function skipBlockQuestions(course, state) {
  if (state.status !== "awaiting-answer") {
    throw new Error("Current block has no questions to skip");
  }
  const questionUnitIds = activeQuestionUnitIds(state);
  const asked = new Set(state.askedQuestionIds ?? []);
  const unasked = questionUnitIds.filter((id) => !asked.has(id));
  if (unasked.length === 0) {
    throw new Error("No unasked questions left in the current block");
  }
  return {
    ...state,
    status: "reviewed",
    askedQuestionIds: [...new Set([...asked, ...unasked])],
    skippedQuestionIds: [...new Set([...(state.skippedQuestionIds ?? []), ...unasked])],
  };
}

export function setReadingMode(course, state, enabled, { timestamp } = {}) {
  const readingMode = Boolean(enabled);
  const next = {
    ...state,
    readingMode,
    readingModeSince: readingMode ? (state.readingModeSince ?? timestamp ?? null) : null,
  };
  if (readingMode && next.status === "awaiting-answer") {
    return skipBlockQuestions(course, next);
  }
  return next;
}

export function answerQuestion(course, state, choice) {
  if (state.status !== "awaiting-answer") {
    throw new Error("Current block is not awaiting an answer");
  }
  const unit = findUnit(course, state.activeQuestionUnitId);
  const correct = choice === unit.check.correct;
  const answer = {
    unitId: unit.id,
    choice,
    correct,
    explanation: unit.check.explanations[choice],
  };
  return {
    ...state,
    status: "reviewed",
    answer,
    answerHistory: [...state.answerHistory, answer],
    askedQuestionIds: [...new Set([...state.askedQuestionIds, unit.id])],
  };
}

export function advanceBlock(course, state) {
  if (state.status !== "reviewed") {
    throw new Error("Answer review is required before advancing");
  }
  const nextQuestionIndex = nextUnaskedQuestionIndex(state);
  if (nextQuestionIndex >= 0) {
    const questionUnitIds = activeQuestionUnitIds(state);
    return {
      ...state,
      activeQuestionUnitIds: questionUnitIds,
      activeQuestionIndex: nextQuestionIndex,
      activeQuestionUnitId: questionUnitIds[nextQuestionIndex],
      status: "awaiting-answer",
      answer: null,
      layers: [],
      practice: null,
    };
  }

  const cursor = state.cursor + state.activeUnitIds.length;
  const completedUnitIds = [...new Set([...state.completedUnitIds, ...state.activeUnitIds])];
  if (cursor >= course.units.length) {
    return {
      ...state,
      cursor,
      completedUnitIds,
      activeUnitIds: [],
      activeQuestionUnitIds: [],
      activeQuestionIndex: 0,
      activeQuestionUnitId: null,
      status: "awaiting-application",
      answer: null,
      layers: [],
      practice: null,
    };
  }
  return initializeActiveBlock(course, {
    ...state,
    cursor,
    completedUnitIds,
    activeUnitIds: [],
    activeQuestionUnitIds: [],
    activeQuestionIndex: 0,
    activeQuestionUnitId: null,
    status: "awaiting-answer",
    answer: null,
    layers: [],
    practice: null,
  });
}

export function selectApplication(course, state, choice) {
  if (state.status !== "awaiting-application") {
    throw new Error("Article is not awaiting an application choice");
  }
  if (!course.application.choices[choice]) {
    throw new Error("Unknown application choice");
  }
  return { ...state, status: "complete", applicationChoice: choice };
}
