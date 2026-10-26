import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogRepository } from "../src/content/catalog-repository.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "course-catalog-"));
  directories.push(root);
  const coursesRoot = path.join(root, "courses");
  const catalogPath = path.join(coursesRoot, "catalog.json");
  await fs.mkdir(coursesRoot, { recursive: true });
  await fs.writeFile(catalogPath, JSON.stringify({
    schemaVersion: 1,
    courses: [
      { id: "build-skills", order: 1, title: "Build skills", summary: "Навыки Codex из официальной статьи." },
      { id: "js-fetch", order: 2, title: "JS Fetch", summary: "Практические запросы к внешнему API." },
    ],
  }), "utf8");
  return { coursesRoot, catalogPath, repository: new CatalogRepository({ coursesRoot, catalogPath }) };
}

describe("CatalogRepository", () => {
  it("loads the published order and resolves matching course files", async () => {
    const { coursesRoot, repository } = await makeRepository();

    expect((await repository.list()).map(({ id }) => id)).toEqual(["build-skills", "js-fetch"]);
    expect(repository.coursePath("build-skills")).toBe(path.join(coursesRoot, "build-skills", "course.json"));
    expect(repository.memoryPath("js-fetch")).toBe(path.join(coursesRoot, "js-fetch", "learning_memory.md"));
  });

  it("refreshes a catalog published by another process and preserves it on the next write", async () => {
    const { coursesRoot, catalogPath, repository } = await makeRepository();
    expect((await repository.list()).map(({ id }) => id)).toEqual(["build-skills", "js-fetch"]);

    const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
    catalog.courses.push({
      id: "new-course",
      order: 3,
      title: "New course",
      summary: "Published outside the running application.",
    });
    const temporaryPath = `${catalogPath}.publish.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, catalogPath);

    const entries = await repository.list();
    expect(entries.map(({ id }) => id)).toEqual(["build-skills", "js-fetch", "new-course"]);
    expect(repository.coursePath("new-course")).toBe(path.join(coursesRoot, "new-course", "course.json"));

    await repository.setArchived("js-fetch", true);
    const persisted = JSON.parse(await fs.readFile(catalogPath, "utf8"));
    expect(persisted.courses.map(({ id }) => id)).toEqual(["build-skills", "js-fetch", "new-course"]);
  });

  it("never resolves a request parameter outside the catalog", async () => {
    const { repository } = await makeRepository();
    await repository.list();

    expect(() => repository.coursePath("..\\secret")).toThrow("Unknown course id");
    expect(() => repository.memoryPath("missing-course")).toThrow("Unknown course id");
  });

  it("persists archived flag and reloads it from disk", async () => {
    const { repository, catalogPath } = await makeRepository();
    await repository.list();

    const archived = await repository.setArchived("js-fetch", true);
    expect(archived.archived).toBe(true);

    const fresh = new CatalogRepository({ coursesRoot: path.dirname(catalogPath), catalogPath });
    const entries = await fresh.list();
    expect(entries.find((e) => e.id === "js-fetch").archived).toBe(true);
    expect(entries.find((e) => e.id === "build-skills").archived).toBe(false);
  });

  it("restores an archived course back to active", async () => {
    const { repository } = await makeRepository();
    await repository.setArchived("build-skills", true);
    await repository.setArchived("build-skills", false);
    const entries = await repository.list();
    expect(entries.find((e) => e.id === "build-skills").archived).toBe(false);
  });

  it("rejects archiving an unknown course", async () => {
    const { repository } = await makeRepository();
    await repository.list();
    await expect(repository.setArchived("missing-course", true)).rejects.toThrow("Unknown course id");
  });
});
