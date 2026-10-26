import { describe, expect, it } from "vitest";
import { createInitialState, normalizeLearningState } from "../src/domain/lesson-state.js";
import {
  advanceBlock,
  answerQuestion,
  completePreparedActivity,
  composeBlock,
  initializeActiveBlock,
  resizeBlock,
  selectApplication,
  setReadingMode,
  skipBlockQuestions,
} from "../src/domain/lesson-engine.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

const course = {
  id: "engine-course",
  contentVersion: 1,
  units: [
    { id: "bp-01", sectionId: "one", relatedGroup: "one", order: 1 },
    { id: "bp-02", sectionId: "one", relatedGroup: "one", order: 2 },
    { id: "bp-03", sectionId: "two", relatedGroup: "two", order: 3 },
    { id: "bp-04", sectionId: "two", relatedGroup: "two", order: 4 },
    { id: "bp-05", sectionId: "three", relatedGroup: "three", order: 5 },
  ],
};

const correctChoices = ["В", "Б", "А", "В", "Б"];
const courseWithChecks = {
  ...course,
  units: course.units.map((unit, index) => ({
    ...unit,
    check: {
      prompt: `Вопрос ${index + 1}`,
      choices: { "А": "Вариант А", "Б": "Вариант Б", "В": "Вариант В" },
      correct: correctChoices[index],
      explanations: { "А": "Разбор А", "Б": "Разбор Б", "В": "Разбор В" },
    },
  })),
  application: {
    prompt: "Выбери применение",
    choices: { "А": "Первое", "Б": "Второе", "В": "Третье" },
  },
};

describe("adaptive block composition", () => {
  it("grows beyond five fragments until the article end", () => {
    const longCourse = makeUniversalCourse();
    let state = initializeActiveBlock(
      longCourse,
      createInitialState(longCourse, { targetSize: 5 }),
    );

    state = resizeBlock(longCourse, state, 1);
    expect(state.targetSize).toBe(6);
    expect(state.activeUnitIds).toEqual(longCourse.units.slice(0, 6).map(({ id }) => id));

    state = resizeBlock(longCourse, state, 1);
    expect(state.targetSize).toBe(7);
    expect(resizeBlock(longCourse, state, 1)).toEqual(state);
  });

  it("normalizes the requested size to the true article end", () => {
    const longCourse = makeUniversalCourse();
    const ending = initializeActiveBlock(
      longCourse,
      createInitialState(longCourse, { cursor: 5, targetSize: 5 }),
    );

    expect(ending.activeUnitIds).toEqual(longCourse.units.slice(5).map(({ id }) => id));
  });

  it("combines adjacent related units", () => {
    const state = createInitialState(course, { cursor: 0, targetSize: 2 });
    expect(composeBlock(course, state).unitIds).toEqual(["bp-01", "bp-02"]);
  });

  it("crosses section boundaries inside one article", () => {
    const state = createInitialState(course, { cursor: 2, targetSize: 3 });
    expect(composeBlock(course, state).unitIds)
      .toEqual(["bp-03", "bp-04", "bp-05"]);
  });

  it("normalizes an oversized target to the remaining article", () => {
    const state = initializeActiveBlock(courseWithChecks, {
      ...createInitialState(courseWithChecks, { cursor: 2, targetSize: 5 }),
      activeUnitIds: ["bp-03", "bp-04"],
      activeQuestionUnitId: "bp-03",
    });
    expect(state.targetSize).toBe(3);
    expect(state.activeUnitIds).toEqual(["bp-03", "bp-04", "bp-05"]);
    expect(state.activeQuestionUnitIds).toEqual(["bp-03", "bp-04", "bp-05"]);
    expect(state.activeQuestionUnitId).toBe("bp-03");
  });

  it("decreases visible content on the first click after normalization", () => {
    const normalized = initializeActiveBlock(courseWithChecks, {
      ...createInitialState(courseWithChecks, { cursor: 2, targetSize: 5 }),
      activeUnitIds: ["bp-03", "bp-04"],
      activeQuestionUnitId: "bp-03",
    });
    const smaller = resizeBlock(courseWithChecks, normalized, -1);
    expect(smaller.targetSize).toBe(2);
    expect(smaller.activeUnitIds).toEqual(["bp-03", "bp-04"]);
    expect(smaller.activeQuestionUnitId).toBe("bp-03");
  });

  it("keeps one question for every visible unit in source order", () => {
    const state = initializeActiveBlock(
      courseWithChecks,
      createInitialState(courseWithChecks, { cursor: 2, targetSize: 2 }),
    );
    expect(state.activeQuestionUnitIds).toEqual(["bp-03", "bp-04"]);
    expect(state.activeQuestionUnitId).toBe("bp-03");
  });

  it("returns the same state when increasing at the article end", () => {
    const state = initializeActiveBlock(
      courseWithChecks,
      createInitialState(courseWithChecks, { cursor: 4, targetSize: 1 }),
    );
    expect(resizeBlock(courseWithChecks, state, 1)).toEqual(state);
  });

  it("rejects resizing after the answer was reviewed", () => {
    const state = {
      ...initializeActiveBlock(courseWithChecks, createInitialState(courseWithChecks)),
      status: "reviewed",
    };
    expect(() => resizeBlock(courseWithChecks, state, 1))
      .toThrow("Block size can only change before answer review");
  });

  it("rebuilds an unanswered block when size changes", () => {
    const state = createInitialState(course, { cursor: 2, targetSize: 1 });
    const resized = resizeBlock(course, state, 1);
    expect(resized.targetSize).toBe(2);
    expect(resized.activeUnitIds).toEqual(["bp-03", "bp-04"]);
    expect(resized.activeQuestionUnitIds).toEqual(["bp-03", "bp-04"]);
    expect(resized.activeQuestionUnitId).toBe("bp-03");
    expect(resized.layers).toEqual([]);
    expect(resized.practice).toBeNull();
  });

  it("does not reduce below one unit", () => {
    const state = createInitialState(course, { cursor: 2, targetSize: 1 });
    expect(resizeBlock(course, state, -1).targetSize).toBe(1);
  });
});

describe("lesson transitions", () => {
  it("does not allow advancing before review", () => {
    const state = initializeActiveBlock(courseWithChecks, createInitialState(courseWithChecks, { cursor: 0, targetSize: 1 }));
    expect(() => advanceBlock(courseWithChecks, state))
      .toThrow("Answer review is required before advancing");
  });

  it("reviews the selected answer locally", () => {
    const state = initializeActiveBlock(courseWithChecks, createInitialState(courseWithChecks, { cursor: 0, targetSize: 1 }));
    const reviewed = answerQuestion(courseWithChecks, state, "В");
    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.answer).toMatchObject({ choice: "В", correct: true });
    expect(reviewed.answerHistory)
      .toContainEqual(expect.objectContaining({ unitId: "bp-01", choice: "В" }));
  });

  it("keeps the local question available when a prepared activity is not completed", () => {
    const activityCourse = makeUniversalCourse({ withActivity: true });
    const state = initializeActiveBlock(activityCourse, createInitialState(activityCourse));

    expect(answerQuestion(activityCourse, state, "А").status).toBe("reviewed");
  });

  it("records an optional prepared activity result for an active unit", () => {
    const activityCourse = makeUniversalCourse({ withActivity: true });
    const state = initializeActiveBlock(activityCourse, createInitialState(activityCourse));
    const completed = completePreparedActivity(activityCourse, state, {
      unitId: state.activeUnitIds[0],
      result: "Команда выполнена, ожидаемый ответ получен.",
      completedAt: "2026-07-19T20:00:00.000Z",
    });

    expect(completed.activityHistory).toEqual([{
      unitId: state.activeUnitIds[0],
      result: "Команда выполнена, ожидаемый ответ получен.",
      completedAt: "2026-07-19T20:00:00.000Z",
    }]);
  });

  it("asks every question in a block before advancing by its number of units", () => {
    const state = initializeActiveBlock(courseWithChecks, createInitialState(courseWithChecks, { cursor: 0, targetSize: 2 }));
    const reviewed = answerQuestion(courseWithChecks, state, "В");
    const secondQuestion = advanceBlock(courseWithChecks, reviewed);
    expect(secondQuestion).toMatchObject({
      status: "awaiting-answer",
      activeQuestionUnitId: "bp-02",
      activeQuestionIndex: 1,
    });
    const secondReviewed = answerQuestion(courseWithChecks, secondQuestion, "Б");
    const next = advanceBlock(courseWithChecks, secondReviewed);
    expect(next.cursor).toBe(2);
    expect(next.activeUnitIds).toEqual(["bp-03", "bp-04"]);
  });

  it("keeps unasked questions from a reviewed legacy multi-fragment block", () => {
    const legacy = {
      ...createInitialState(courseWithChecks, { targetSize: 3 }),
      activeUnitIds: ["bp-01", "bp-02", "bp-03"],
      activeQuestionUnitId: "bp-03",
      status: "reviewed",
      answer: { unitId: "bp-03", choice: "А", correct: true, explanation: "Разбор А" },
      answerHistory: [{ unitId: "bp-03", choice: "А", correct: true, explanation: "Разбор А" }],
      askedQuestionIds: ["bp-03"],
    };
    delete legacy.activeQuestionUnitIds;
    delete legacy.activeQuestionIndex;

    const migrated = normalizeLearningState(legacy, courseWithChecks);
    expect(migrated.activeQuestionUnitId).toBe("bp-03");
    const firstUnasked = advanceBlock(courseWithChecks, migrated);
    expect(firstUnasked).toMatchObject({
      status: "awaiting-answer",
      activeQuestionUnitId: "bp-01",
    });
  });

  it("finishes only after one practical application is selected", () => {
    const state = initializeActiveBlock(courseWithChecks, createInitialState(courseWithChecks, { cursor: 4, targetSize: 1 }));
    const reviewed = answerQuestion(courseWithChecks, state, "Б");
    const application = advanceBlock(courseWithChecks, reviewed);
    expect(application.status).toBe("awaiting-application");
    const complete = selectApplication(courseWithChecks, application, "В");
    expect(complete).toMatchObject({ status: "complete", applicationChoice: "В" });
  });
});

describe("skipping block questions and reading mode", () => {
  const started = () => initializeActiveBlock(
    courseWithChecks,
    createInitialState(courseWithChecks, { targetSize: 2 }),
  );

  it("skips every question of the block and lets the lesson continue", () => {
    const skipped = skipBlockQuestions(courseWithChecks, started());
    expect(skipped.status).toBe("reviewed");
    expect(skipped.skippedQuestionIds).toEqual(["bp-01", "bp-02"]);
    expect(skipped.askedQuestionIds).toEqual(["bp-01", "bp-02"]);
    const advanced = advanceBlock(courseWithChecks, skipped);
    expect(advanced.cursor).toBe(2);
    expect(advanced.completedUnitIds).toEqual(["bp-01", "bp-02"]);
  });

  it("records a skipped question separately from an answered one", () => {
    let state = started();
    state = answerQuestion(courseWithChecks, state, "В");
    state = advanceBlock(courseWithChecks, state);
    expect(state.activeQuestionUnitId).toBe("bp-02");
    state = skipBlockQuestions(courseWithChecks, state);
    expect(state.skippedQuestionIds).toEqual(["bp-02"]);
    expect(state.answerHistory).toHaveLength(1);
  });

  it("refuses to skip when there is nothing left to skip", () => {
    const skipped = skipBlockQuestions(courseWithChecks, started());
    expect(() => skipBlockQuestions(courseWithChecks, skipped)).toThrow();
    expect(() => skipBlockQuestions(
      courseWithChecks,
      { ...started(), status: "reviewed" },
    )).toThrow();
  });

  it("reading mode closes the current block and opens next ones without questions", () => {
    let state = setReadingMode(courseWithChecks, started(), true, { timestamp: "2026-09-22T10:00:00.000Z" });
    expect(state.status).toBe("reviewed");
    expect(state.readingMode).toBe(true);
    expect(state.readingModeSince).toBe("2026-09-22T10:00:00.000Z");
    state = advanceBlock(courseWithChecks, state);
    expect(state.status).toBe("reviewed");
    expect(state.activeUnitIds).toEqual(["bp-03", "bp-04"]);
    expect(state.activeQuestionUnitIds).toEqual([]);
  });

  it("disabling reading mode brings questions back on the next block", () => {
    let state = setReadingMode(courseWithChecks, started(), true, { timestamp: "2026-09-22T10:00:00.000Z" });
    state = advanceBlock(courseWithChecks, state);
    state = setReadingMode(courseWithChecks, state, false);
    expect(state.readingMode).toBe(false);
    expect(state.readingModeSince).toBe(null);
    state = advanceBlock(courseWithChecks, state);
    expect(state.status).toBe("awaiting-answer");
    expect(state.activeQuestionUnitId).toBe("bp-05");
  });

  it("allows resizing blocks while reading", () => {
    let state = setReadingMode(courseWithChecks, started(), true, { timestamp: "2026-09-22T10:00:00.000Z" });
    state = resizeBlock(courseWithChecks, state, -1);
    expect(state.status).toBe("reviewed");
    expect(state.activeUnitIds).toEqual(["bp-01"]);
    state = advanceBlock(courseWithChecks, state);
    expect(state.activeUnitIds).toEqual(["bp-02"]);
  });
});
