import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningService } from "../src/application/learning-service.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { initializeActiveBlock } from "../src/domain/lesson-engine.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";
import { makeVideoCourse } from "./fixtures/video-course.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function makeVideoHarness() {
  const course = makeVideoCourse();
  let current = structuredClone(initializeActiveBlock(course, createInitialState(course)));
  const store = {
    load: vi.fn(async () => structuredClone(current)),
    save: vi.fn(async (next) => {
      current = structuredClone(next);
    }),
  };
  const service = new LearningService({
    course,
    store,
    provider: { generate: vi.fn() },
    promptBuilder: vi.fn(),
    clock: () => new Date("2026-08-01T12:00:00.000Z"),
  });
  return { course, service, store };
}

describe("Video learning service", () => {
  it("does not expose correct answers before the video question is answered", async () => {
    const { service } = makeVideoHarness();
    const view = await service.getView();
    expect(view.courseMode).toBe("video");
    expect(view.videoChapter).toMatchObject({
      id: "introduction",
      startSeconds: 0,
      endSeconds: 353,
      status: "ready",
    });
    expect(view.question).toMatchObject({
      id: "introduction-question-1",
      choices: expect.any(Object),
    });
    expect(view.question).not.toHaveProperty("correct");
    expect(view.question).not.toHaveProperty("explanations");
  });

  it("returns feedback only after the current question answer", async () => {
    const { service } = makeVideoHarness();
    const view = await service.answerVideoQuestion("introduction-question-1", "А");
    expect(view.questionReview).toMatchObject({
      questionId: "introduction-question-1",
      choice: "А",
      correct: true,
      explanations: expect.any(Object),
    });
  });

  it("updates video position without changing question state", async () => {
    const { service } = makeVideoHarness();
    const before = await service.getView();
    const after = await service.updateVideoProgress("introduction", 197);
    expect(after.videoProgress.positionSeconds).toBe(197);
    expect(after.question.id).toBe(before.question.id);
  });

  it("returns a read-only playlist snapshot without answer or transcript content", async () => {
    const { course, service, store } = makeVideoHarness();
    const before = await store.load();
    const snapshot = await service.getPlaylistLessonSnapshot();
    const after = await store.load();

    expect(snapshot).toMatchObject({
      availability: "available",
      courseId: course.id,
      contentVersion: course.contentVersion,
      videoId: course.videoSource.videoId,
      hasLearningActivity: false,
    });
    expect(snapshot.chapters[0]).toMatchObject({ id: "introduction", unitId: "introduction", status: "current" });
    expect(JSON.stringify(snapshot)).not.toContain(course.units[0].coreText);
    expect(JSON.stringify(snapshot)).not.toContain("correct");
    expect(after).toEqual(before);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("preserves learning-memory bytes while projecting the playlist snapshot", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "playlist-snapshot-memory-"));
    temporaryDirectories.push(directory);
    const course = makeVideoCourse();
    const memoryPath = path.join(directory, "learning_memory.md");
    const store = new LearningMemoryStore(memoryPath);
    await store.create(createInitialState(course), { humanText: "# Snapshot test" });
    const before = await fs.readFile(memoryPath);
    const service = new LearningService({
      course,
      store,
      provider: { generate: vi.fn() },
      promptBuilder: vi.fn(),
    });

    await service.getPlaylistLessonSnapshot();

    expect(await fs.readFile(memoryPath)).toEqual(before);
  });
});
