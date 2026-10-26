import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendVideoCourseMigration,
  buildMigrationArchivePath,
} from "../scripts/migrate-video-course-append.mjs";
import { initializeActiveBlock } from "../src/domain/lesson-engine.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";
import { makeVideoCourse } from "./fixtures/video-course.js";

const directories = [];
const timestamp = new Date("2026-08-01T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function makeCandidate(oldCourse) {
  const candidate = structuredClone(oldCourse);
  candidate.contentVersion = oldCourse.contentVersion + 1;
  candidate.videoSource.chapters[1] = {
    ...candidate.videoSource.chapters[1],
    status: "ready",
    unitId: "orca-workspace",
    subtitleAsset: {
      fileName: "orca-workspace.ru.vtt",
      mimeType: "text/vtt",
      sizeBytes: 48,
      sha256: "1".repeat(64),
      language: "ru",
      extractorVersion: "2026.07.04",
    },
  };
  candidate.units.push({
    id: "orca-workspace",
    sectionId: "video-chapters",
    order: 2,
    title: "Orca workspace",
    coreText: "Очищенная расшифровка второй главы с достаточной длиной для проверки append-only миграции.",
    sourceRefs: ["source-orca-workspace"],
    estimatedMinutes: 12,
    checks: ["А", "Б", "В"].map((correct, index) => ({
      id: `orca-workspace-question-${index + 1}`,
      prompt: `Проверочный вопрос второй главы номер ${index + 1}?`,
      choices: { "А": "Похожий вариант А", "Б": "Похожий вариант Б", "В": "Похожий вариант В" },
      correct,
      explanations: { "А": "Разбор А.", "Б": "Разбор Б.", "В": "Разбор В." },
    })),
    transcript: {
      language: "ru",
      kind: "cleaned",
      blocks: [{
        id: "orca-workspace-opening",
        startSeconds: 400,
        endSeconds: 470,
        text: "Смысловой абзац второй главы с проверяемой временной меткой.",
      }],
    },
    artifactRefs: ["video-orca-workspace"],
  });
  candidate.coverage.push({
    id: "source-orca-workspace",
    sourceHeading: "Orca workspace 5:53-13:42",
    unitIds: ["orca-workspace"],
  });
  candidate.sourceArtifacts.push({
    id: "video-orca-workspace",
    kind: "video",
    sourceHeading: "Orca workspace",
    caption: "Вторая глава ролика.",
    coverage: "covered",
    unitIds: ["orca-workspace"],
    exclusionReason: null,
    content: {
      type: "youtube",
      videoId: "ocbtH4-FttI",
      startSeconds: 353,
      endSeconds: 822,
      accessibilityText: "Рабочее пространство Orca",
    },
  });
  candidate.source.artifactAudit.artifactCount = candidate.sourceArtifacts.length;
  return candidate;
}

async function makeMigrationFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-append-"));
  directories.push(root);
  const courseDirectory = path.join(root, "courses", "youtube-video-course");
  const archiveRoot = path.join(root, "_archive");
  await fs.mkdir(courseDirectory, { recursive: true });
  const course = makeVideoCourse();
  const coursePath = path.join(courseDirectory, "course.json");
  await fs.writeFile(coursePath, JSON.stringify(course, null, 2) + "\n", "utf8");
  const memoryPath = path.join(courseDirectory, "learning_memory.md");
  const state = initializeActiveBlock(course, createInitialState(course));
  state.cursor = 1;
  state.activeUnitIds = [];
  state.activeQuestionUnitId = null;
  state.status = "waiting-content";
  state.lifecycleStatus = "waiting-content";
  state.completedUnitIds = ["introduction"];
  state.videoProgress = {
    introduction: { positionSeconds: 353, watched: true, updatedAt: "2026-08-01T10:00:00.000Z" },
  };
  state.questionProgress = {
    introduction: {
      nextQuestionIndex: 3,
      answers: [{
        questionId: "introduction-question-1",
        choice: "А",
        correct: true,
        explanation: "Разбор варианта А.",
        answeredAt: "2026-08-01T10:00:00.000Z",
      }],
    },
  };
  await new LearningMemoryStore(memoryPath).create(state, { humanText: "# Video memory" });
  const candidatePath = path.join(root, "course-v2.json");
  const candidate = makeCandidate(course);
  await fs.writeFile(candidatePath, JSON.stringify(candidate, null, 2) + "\n", "utf8");
  return { archiveRoot, candidate, candidatePath, course, courseDirectory, coursePath, memoryPath };
}

describe("append-only video course migration", () => {
  it("archives old bytes and adds exactly one ready chapter without losing progress", async () => {
    const fixture = await makeMigrationFixture();
    const oldCourseBytes = await fs.readFile(fixture.coursePath);
    const oldMemoryBytes = await fs.readFile(fixture.memoryPath);

    const result = await appendVideoCourseMigration({
      courseId: "youtube-video-course",
      courseDirectory: fixture.courseDirectory,
      memoryPath: fixture.memoryPath,
      candidatePath: fixture.candidatePath,
      archiveRoot: fixture.archiveRoot,
      now: () => timestamp,
    });

    expect(result).toMatchObject({
      courseId: "youtube-video-course",
      contentVersion: 2,
      transitionedChapterId: "orca-workspace",
    });
    expect(await fs.readFile(path.join(result.archivePath, "course.json"))).toEqual(oldCourseBytes);
    expect(await fs.readFile(path.join(result.archivePath, "learning_memory.md"))).toEqual(oldMemoryBytes);
    const sums = JSON.parse(await fs.readFile(path.join(result.archivePath, "SHA256SUMS.json"), "utf8"));
    expect(sums.course.sha256).toBe(createHash("sha256").update(oldCourseBytes).digest("hex"));
    expect(sums.memory.sha256).toBe(createHash("sha256").update(oldMemoryBytes).digest("hex"));

    const liveCourse = JSON.parse(await fs.readFile(fixture.coursePath, "utf8"));
    expect(liveCourse.contentVersion).toBe(2);
    expect(liveCourse.videoSource.chapters[0]).toEqual(fixture.course.videoSource.chapters[0]);
    expect(liveCourse.units[0]).toEqual(fixture.course.units[0]);
    expect(liveCourse.sourceArtifacts[0]).toEqual(fixture.course.sourceArtifacts[0]);
    expect(liveCourse.videoSource.chapters[1].status).toBe("ready");
    expect(liveCourse.units).toHaveLength(2);

    const state = await new LearningMemoryStore(fixture.memoryPath).load();
    expect(state).toMatchObject({
      version: 5,
      contentVersion: 2,
      lifecycleStatus: "in-progress",
      activeUnitIds: ["orca-workspace"],
      completedUnitIds: ["introduction"],
    });
    expect(state.videoProgress.introduction).toMatchObject({ watched: true, positionSeconds: 353 });
    expect(state.questionProgress.introduction.answers).toHaveLength(1);
    expect(state.completedUnitIds).not.toContain("orca-workspace");
  });

  it("rejects any rewrite of existing prepared content before live files change", async () => {
    const fixture = await makeMigrationFixture();
    const beforeCourse = await fs.readFile(fixture.coursePath);
    const beforeMemory = await fs.readFile(fixture.memoryPath);
    fixture.candidate.units[0].coreText = "Подменённый текст первого подготовленного сегмента.";
    await fs.writeFile(fixture.candidatePath, JSON.stringify(fixture.candidate, null, 2), "utf8");

    await expect(appendVideoCourseMigration({
      courseId: "youtube-video-course",
      courseDirectory: fixture.courseDirectory,
      memoryPath: fixture.memoryPath,
      candidatePath: fixture.candidatePath,
      archiveRoot: fixture.archiveRoot,
      now: () => timestamp,
    })).rejects.toThrow("Existing prepared content changed");

    expect(await fs.readFile(fixture.coursePath)).toEqual(beforeCourse);
    expect(await fs.readFile(fixture.memoryPath)).toEqual(beforeMemory);
  });

  it("refuses to overwrite a pre-existing migration archive", async () => {
    const fixture = await makeMigrationFixture();
    const archivePath = buildMigrationArchivePath({
      archiveRoot: fixture.archiveRoot,
      courseId: "youtube-video-course",
      contentVersion: 1,
      now: timestamp,
    });
    await fs.mkdir(archivePath, { recursive: true });
    await fs.writeFile(path.join(archivePath, "keep.txt"), "do not overwrite", "utf8");

    await expect(appendVideoCourseMigration({
      courseId: "youtube-video-course",
      courseDirectory: fixture.courseDirectory,
      memoryPath: fixture.memoryPath,
      candidatePath: fixture.candidatePath,
      archiveRoot: fixture.archiveRoot,
      now: () => timestamp,
    })).rejects.toThrow("Migration archive already exists");

    expect(await fs.readFile(path.join(archivePath, "keep.txt"), "utf8")).toBe("do not overwrite");
  });
});
