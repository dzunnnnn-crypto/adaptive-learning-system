import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSeedArguments, seedNewCourseState } from "../scripts/seed-current-state.js";
import { CatalogRepository } from "../src/content/catalog-repository.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";
import { makeVideoCourse } from "./fixtures/video-course.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seed-new-course-"));
  directories.push(root);
  const coursesRoot = path.join(root, "courses");
  const courseRoot = path.join(coursesRoot, "new-course");
  await fs.mkdir(courseRoot, { recursive: true });
  await fs.writeFile(path.join(coursesRoot, "catalog.json"), JSON.stringify({
    schemaVersion: 1,
    courses: [{
      id: "new-course",
      order: 1,
      title: "Новый курс",
      summary: "Новый безопасный учебный курс для проверки.",
    }],
  }), "utf8");
  await fs.writeFile(path.join(courseRoot, "course.json"), JSON.stringify({
    ...makeUniversalCourse(),
    id: "new-course",
    title: "Новый курс",
  }), "utf8");
  return new CatalogRepository({ coursesRoot, catalogPath: path.join(coursesRoot, "catalog.json") });
}

async function makeVideoRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seed-video-course-"));
  directories.push(root);
  const coursesRoot = path.join(root, "courses");
  const courseRoot = path.join(coursesRoot, "youtube-video-course");
  await fs.mkdir(courseRoot, { recursive: true });
  await fs.writeFile(path.join(coursesRoot, "catalog.json"), JSON.stringify({
    schemaVersion: 1,
    courses: [{
      id: "youtube-video-course",
      order: 1,
      title: "Тестовый видеокурс",
      summary: "Тестовая глава YouTube.",
    }],
  }), "utf8");
  await fs.writeFile(path.join(courseRoot, "course.json"), JSON.stringify(makeVideoCourse()), "utf8");
  return new CatalogRepository({ coursesRoot, catalogPath: path.join(coursesRoot, "catalog.json") });
}

describe("seedNewCourseState", () => {
  it("creates only a missing published course memory at the new checkpoint", async () => {
    const catalogRepository = await makeRepository();

    const created = await seedNewCourseState({ courseId: "new-course", catalogRepository });
    const state = await new LearningMemoryStore(created.memoryPath).load();

    expect(state).toMatchObject({
      version: 4,
      courseId: "new-course",
      lifecycleStatus: "new",
      cursor: 0,
      status: "awaiting-answer",
    });
    expect(state.activeUnitIds).toEqual(["foundation-goal"]);
  });

  it("creates an explicit five-unit initial block without changing the cursor", async () => {
    const catalogRepository = await makeRepository();

    const created = await seedNewCourseState({
      courseId: "new-course",
      catalogRepository,
      targetSize: 5,
    });
    const state = await new LearningMemoryStore(created.memoryPath).load();

    expect(state).toMatchObject({
      targetSize: 5,
      cursor: 0,
      activeQuestionUnitId: "foundation-goal",
    });
    expect(state.activeUnitIds).toEqual([
      "foundation-goal",
      "foundation-context",
      "foundation-constraints",
      "practice-plan",
      "practice-test",
    ]);
    expect(state.activeQuestionUnitIds).toEqual(state.activeUnitIds);
  });

  it("seeds a video course with state version five and one active chapter", async () => {
    const catalogRepository = await makeVideoRepository();
    const created = await seedNewCourseState({
      courseId: "youtube-video-course",
      catalogRepository,
    });

    expect(created.state).toMatchObject({
      version: 5,
      lifecycleStatus: "new",
      cursor: 0,
      activeUnitIds: ["introduction"],
      videoProgress: {},
      questionProgress: {},
    });
  });

  it("refuses to overwrite an existing learning memory", async () => {
    const catalogRepository = await makeRepository();
    await seedNewCourseState({ courseId: "new-course", catalogRepository });

    await expect(seedNewCourseState({ courseId: "new-course", catalogRepository }))
      .rejects.toThrow("Learning memory already exists");
  });

  it("parses only the documented optional target-size syntax", () => {
    expect(parseSeedArguments(["new-course", "--new"])).toEqual({
      courseId: "new-course",
      targetSize: 1,
    });
    expect(parseSeedArguments(["new-course", "--new", "--target-size", "5"])).toEqual({
      courseId: "new-course",
      targetSize: 5,
    });
    expect(() => parseSeedArguments(["new-course", "--new", "--target-size", "0"]))
      .toThrow("Usage:");
    expect(() => parseSeedArguments(["new-course", "--new", "--target-size", "1.5"]))
      .toThrow("Usage:");
    expect(() => parseSeedArguments(["new-course", "--new", "--target-size"]))
      .toThrow("Usage:");
    expect(() => parseSeedArguments(["new-course", "--new", "--unexpected", "5"]))
      .toThrow("Usage:");
  });
});
