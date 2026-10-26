import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCourse } from "../src/content/course-repository.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function writeCourse(course) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "course-repository-"));
  directories.push(directory);
  const file = path.join(directory, "course.json");
  await fs.writeFile(file, JSON.stringify(course), "utf8");
  return file;
}

describe("loadCourse", () => {
  it("loads a verified universal package", async () => {
    const course = await loadCourse(await writeCourse(makeUniversalCourse()));
    expect(course.id).toBe("sample-article");
  });

  it("rejects a package whose source requires review", async () => {
    await expect(loadCourse(await writeCourse(makeUniversalCourse({ sourceStatus: "needs-review" }))))
      .rejects.toThrow("Course source requires review");
  });
});
