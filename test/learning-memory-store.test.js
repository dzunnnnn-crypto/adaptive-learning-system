import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeLearningState } from "../src/domain/lesson-state.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

const dirs = [];
const course = makeUniversalCourse();

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function copyFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "learning-memory-"));
  dirs.push(dir);
  const target = path.join(dir, "learning_memory.md");
  await fs.copyFile("test/fixtures/learning-memory.md", target);
  return target;
}

describe("LearningMemoryStore", () => {
  it("loads a versioned state for the active article", async () => {
    const store = new LearningMemoryStore(await copyFixture());
    const state = await store.load();
    expect(state.version).toBe(4);
    expect(state.courseId).toBe("sample-article");
    expect(state.contentVersion).toBe(1);
    expect(state.cursor).toBe(0);
    expect(state.targetSize).toBe(1);
    expect(state.status).toBe("awaiting-answer");
  });

  it("round-trips a machine state without rewriting human text", async () => {
    const file = await copyFixture();
    const store = new LearningMemoryStore(file);
    const original = await fs.readFile(file, "utf8");
    const humanText = original.split("<!-- adaptive-learning-state:start")[0].trim();
    const state = {
      ...(await store.load()),
      targetSize: 3,
      updatedAt: "2026-07-19T20:00:00.000Z",
    };
    await store.save(state);
    const loaded = await store.load();
    const changed = await fs.readFile(file, "utf8");
    expect(loaded.targetSize).toBe(3);
    expect(changed).toContain(humanText);
  });

  it("rejects an incompatible legacy state without writing the file", async () => {
    const file = await copyFixture();
    const store = new LearningMemoryStore(file);
    await store.save({
      ...(await store.load()),
      version: 1,
      activeUnitIds: ["foundation-goal"],
      activeQuestionUnitId: "foundation-goal",
    });
    const before = await fs.readFile(file, "utf8");
    const legacy = await store.load();
    expect(() => normalizeLearningState(legacy, course))
      .toThrow("Learning state is incompatible with the active course");
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
});
