import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/domain/lesson-state.js";
import { initializeActiveBlock } from "../src/domain/lesson-engine.js";
import {
  answerVideoQuestion,
  advanceVideoQuestion,
  currentVideoQuestion,
  setVideoReadingMode,
  skipVideoQuestions,
  updateVideoProgress,
} from "../src/domain/video-lesson-engine.js";
import { makeVideoCourse } from "./fixtures/video-course.js";

const NOW = "2026-08-01T12:00:00.000Z";

describe("Video lesson engine", () => {
  it("answers three video questions in order", () => {
    const course = makeVideoCourse();
    let state = initializeActiveBlock(course, createInitialState(course));
    state = answerVideoQuestion(course, state, "introduction-question-1", "А", NOW);
    expect(state.status).toBe("video-question-reviewed");
    state = advanceVideoQuestion(course, state);
    expect(currentVideoQuestion(course, state).id).toBe("introduction-question-2");
  });

  it("completes the ready segment on the third answer and waits for content", () => {
    const course = makeVideoCourse();
    let state = initializeActiveBlock(course, createInitialState(course));
    for (let index = 1; index <= 3; index += 1) {
      state = answerVideoQuestion(
        course,
        state,
        "introduction-question-" + index,
        ["А", "Б", "В"][index - 1],
        NOW,
      );
      expect(state.status).toBe("video-question-reviewed");
      if (index < 3) state = advanceVideoQuestion(course, state);
    }
    expect(state.status).toBe("video-question-reviewed");
    state = advanceVideoQuestion(course, state);
    expect(state).toMatchObject({
      status: "waiting-content",
      lifecycleStatus: "waiting-content",
      cursor: 1,
      completedUnitIds: ["introduction"],
    });
  });

  it("saves and clamps an unfinished video position", () => {
    const course = makeVideoCourse();
    const state = initializeActiveBlock(course, createInitialState(course));
    expect(updateVideoProgress(course, state, "introduction", 197, NOW)
      .videoProgress.introduction).toMatchObject({
        positionSeconds: 197,
        watched: false,
      });
  });

  it("marks watched at the end and never lets the client clear it", () => {
    const course = makeVideoCourse();
    let state = initializeActiveBlock(course, createInitialState(course));
    state = updateVideoProgress(course, state, "introduction", 352, NOW);
    state = updateVideoProgress(course, state, "introduction", 10, NOW);
    expect(state.videoProgress.introduction).toMatchObject({
      positionSeconds: 10,
      watched: true,
    });
  });

  it("classifies non-current questions and unavailable video chapters", () => {
    const course = makeVideoCourse();
    const state = initializeActiveBlock(course, createInitialState(course));
    const categoryOf = (action) => {
      try {
        action();
      } catch (error) {
        return error.category;
      }
      return null;
    };
    expect(categoryOf(() => answerVideoQuestion(course, state, "introduction-question-2", "Б", NOW)))
      .toBe("video-question-not-current");
    expect(categoryOf(() => updateVideoProgress(course, state, "orca-workspace", 400, NOW)))
      .toBe("video-segment-planned");
    expect(categoryOf(() => updateVideoProgress(course, state, "unknown-segment", 400, NOW)))
      .toBe("video-segment-not-found");
  });
});

describe("skipping chapter questions and reading mode", () => {
  const started = (course) => initializeActiveBlock(course, createInitialState(course));

  it("skips the remaining chapter questions at once", () => {
    const course = makeVideoCourse();
    let state = started(course);
    state = answerVideoQuestion(course, state, "introduction-question-1", "А", NOW);
    state = advanceVideoQuestion(course, state);
    state = skipVideoQuestions(course, state, { timestamp: NOW });
    expect(state.status).toBe("video-question-reviewed");
    const answers = state.questionProgress.introduction.answers;
    expect(answers).toHaveLength(3);
    expect(answers[0].skipped).toBeUndefined();
    expect(answers.slice(1).every((entry) => entry.skipped)).toBe(true);
    const advanced = advanceVideoQuestion(course, state);
    expect(advanced.completedUnitIds).toEqual(["introduction"]);
  });

  it("refuses to skip when nothing is left", () => {
    const course = makeVideoCourse();
    const state = started(course);
    const skipped = skipVideoQuestions(course, state, { timestamp: NOW });
    expect(() => skipVideoQuestions(course, skipped, { timestamp: NOW })).toThrow();
  });

  it("reading mode opens chapters reviewed and finishes them without questions", () => {
    const course = makeVideoCourse();
    let state = setVideoReadingMode(course, started(course), true, { timestamp: NOW });
    expect(state.status).toBe("video-question-reviewed");
    expect(state.readingMode).toBe(true);
    expect(currentVideoQuestion(course, state)).toBe(null);
    state = advanceVideoQuestion(course, state);
    expect(state).toMatchObject({
      status: "waiting-content",
      cursor: 1,
      completedUnitIds: ["introduction"],
    });
    expect(state.questionProgress.introduction.answers.some((entry) => entry.skipped)).toBe(true);
  });

  it("keeps saving the video position in reading mode", () => {
    const course = makeVideoCourse();
    let state = setVideoReadingMode(course, started(course), true, { timestamp: NOW });
    state = updateVideoProgress(course, state, "introduction", 197, NOW);
    expect(state.videoProgress.introduction.positionSeconds).toBe(197);
  });
});
