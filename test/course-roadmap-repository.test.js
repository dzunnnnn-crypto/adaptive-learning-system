import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CourseRoadmapRepository } from "../src/content/course-roadmap-repository.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeRepository() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "course-roadmaps-"));
  directories.push(directory);
  const roadmapsPath = path.join(directory, "roadmaps.json");
  await fs.writeFile(roadmapsPath, JSON.stringify({
    schemaVersion: 1,
    roadmaps: [{
      id: "agent-workflow",
      title: "Агенты",
      sections: [{
        id: "module-one",
        title: "Модуль 1",
        order: 1,
        items: [{ id: "introduction", title: "Введение", order: 1, courseId: "intro-course" }],
      }],
    }],
  }), "utf8");
  const appStatePath = path.join(directory, "app-state.json");
  const memoryPath = path.join(directory, "learning_memory.md");
  await fs.writeFile(appStatePath, '{"lastCourseId":"existing"}\n', "utf8");
  await fs.writeFile(memoryPath, "Учебная память остаётся прежней.\n", "utf8");
  return {
    appStatePath,
    directory,
    memoryPath,
    repository: new CourseRoadmapRepository({ roadmapsPath }),
    roadmapsPath,
  };
}

describe("CourseRoadmapRepository", () => {
  it("finds the roadmap for a linked course without exposing mutable cache state", async () => {
    const { repository } = await makeRepository();
    const roadmap = await repository.forCourse("intro-course");
    roadmap.title = "Изменено";
    expect((await repository.forCourse("intro-course")).title).toBe("Агенты");
  });

  it("returns null for an unrelated course", async () => {
    const { repository } = await makeRepository();
    await expect(repository.forCourse("other-course")).resolves.toBeNull();
  });

  it("reloads a replaced roadmap without writing learning state", async () => {
    const { appStatePath, memoryPath, repository, roadmapsPath } = await makeRepository();
    expect((await repository.list())[0].id).toBe("agent-workflow");
    const before = await Promise.all([appStatePath, memoryPath].map((filePath) => fs.readFile(filePath)));

    const nextDocument = {
      schemaVersion: 1,
      roadmaps: [
        {
          id: "agent-workflow",
          title: "Обновлённая карта",
          sections: [{
            id: "module-one",
            title: "Модуль 1",
            order: 1,
            items: [{ id: "introduction", title: "Введение", order: 1, courseId: "intro-course" }],
          }],
        },
        {
          id: "salt-playlist",
          title: "Обучение Битрикс24",
          kind: "youtube-playlist",
          author: "Соль Академия",
          sourceUrl: "https://www.youtube.com/playlist?list=PLabc123",
          addedAt: "2026-10-10",
          sections: [{
            id: "lessons",
            title: "Видеоуроки",
            order: 1,
            items: [
              { id: "lesson-one", title: "Урок 1", order: 1, courseId: "salt-first" },
              { id: "lesson-two", title: "Урок 2", order: 2 },
            ],
          }],
        },
      ],
    };
    const replacementPath = `${roadmapsPath}.replacement`;
    await fs.writeFile(replacementPath, JSON.stringify(nextDocument), "utf8");
    await fs.rename(replacementPath, roadmapsPath);

    const refreshed = await repository.list();
    expect(refreshed.map(({ id }) => id)).toEqual(["agent-workflow", "salt-playlist"]);
    expect((await repository.forCourse("salt-first")).sections[0].items[1].title).toBe("Урок 2");
    const after = await Promise.all([appStatePath, memoryPath].map((filePath) => fs.readFile(filePath)));
    expect(after).toEqual(before);
  });

  it("does not serve a cached roadmap after the replacement becomes invalid", async () => {
    const { repository, roadmapsPath } = await makeRepository();
    const original = await repository.list();
    await fs.writeFile(roadmapsPath, '{"schemaVersion":1,"roadmaps":[{}]}', "utf8");
    await expect(repository.list()).rejects.toThrow();
    expect(original[0].id).toBe("agent-workflow");
  });
});
