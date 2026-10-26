import { API_VERSION, APP_ID } from "../app-identity.js";
import {
  selectRenderableCourseArtifacts,
} from "../content/renderable-course-artifacts.js";

function reviewError(category, message) {
  return Object.assign(new Error(message), { category });
}

function buildVideoUnitReview(course, state, unitId) {
  const unit = course.units.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw reviewError("review-unit-not-found", "Unknown review unit");
  }
  if (!state.completedUnitIds.includes(unitId)) {
    throw reviewError("review-unit-forbidden", "Review unit is not completed");
  }
  const section = course.sections.find((candidate) => candidate.id === unit.sectionId);
  const progress = state.questionProgress[unitId];
  const answeredQuestions = (progress?.answers ?? []).map((answer) => {
    const question = unit.checks.find((q) => q.id === answer.questionId);
    return {
      questionId: answer.questionId,
      prompt: question?.prompt,
      choice: answer.choice,
      correct: answer.correct,
      correctAnswer: question?.correct,
      explanation: answer.explanation,
      explanations: question?.explanations,
      skipped: answer.skipped === true,
    };
  });
  const skippedQuestions = answeredQuestions
    .filter((entry) => entry.skipped)
    .map((entry) => ({ prompt: entry.prompt }));
  return {
    appId: APP_ID,
    apiVersion: API_VERSION,
    courseId: course.id,
    courseTitle: course.title,
    section: { id: section.id, title: section.title },
    unit: {
      id: unit.id,
      title: unit.title,
      coreText: unit.coreText,
      transcript: unit.transcript,
    },
    sourceArtifacts: selectRenderableCourseArtifacts(course, [unit]),
    answeredQuestions,
    skippedQuestions,
  };
}

export function buildCompletedUnitReview(course, state, unitId) {
  if (course.schemaVersion === 7) {
    return buildVideoUnitReview(course, state, unitId);
  }
  const unit = course.units.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw reviewError("review-unit-not-found", "Unknown review unit");
  }
  if (!state.completedUnitIds.includes(unitId)) {
    throw reviewError("review-unit-forbidden", "Review unit is not completed");
  }
  const section = course.sections.find((candidate) => candidate.id === unit.sectionId);
  const skippedSet = new Set(state.skippedQuestionIds ?? []);
  const skippedQuestions = unit.check && skippedSet.has(unit.id)
    ? [{ prompt: unit.check.prompt }]
    : [];

  return {
    appId: APP_ID,
    apiVersion: API_VERSION,
    courseId: course.id,
    courseTitle: course.title,
    section: { id: section.id, title: section.title },
    unit: {
      id: unit.id,
      title: unit.title,
      ...(unit.contentBlocks
        ? { contentBlocks: unit.contentBlocks }
        : { coreText: unit.coreText }),
    },
    sourceArtifacts: selectRenderableCourseArtifacts(course, [unit]),
    skippedQuestions,
  };
}
