import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppStateStore } from "../src/persistence/app-state-store.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makePath() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "app-state-"));
  directories.push(root);
  return path.join(root, "nested", "app-state.json");
}

describe("AppStateStore", () => {
  it("treats only a missing file as an empty application state", async () => {
    const file = await makePath();

    expect(await new AppStateStore(file).load()).toEqual({
      lastCourseId: null,
      aiProfileId: "codex-terra-medium",
    });
  });

  it("saves and loads the last course atomically", async () => {
    const file = await makePath();
    const store = new AppStateStore(file);

    await store.save({ lastCourseId: "js-fetch", aiProfileId: "codex-sol-xhigh" });

    expect(await store.load()).toEqual({
      lastCourseId: "js-fetch",
      aiProfileId: "codex-sol-xhigh",
    });
    await expect(fs.readFile(`${file}.tmp`, "utf8")).rejects.toThrow();
  });

  it("does not hide invalid persisted JSON", async () => {
    const file = await makePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "not json", "utf8");

    await expect(new AppStateStore(file).load()).rejects.toThrow();
  });

  it("migrates missing or removed profile IDs to Terra Medium", async () => {
    const file = await makePath();
    await fs.mkdir(path.dirname(file), { recursive: true });

    await fs.writeFile(file, '{"lastCourseId":"js-fetch"}\n', "utf8");
    expect(await new AppStateStore(file).load()).toEqual({
      lastCourseId: "js-fetch",
      aiProfileId: "codex-terra-medium",
    });

    await fs.writeFile(file, '{"lastCourseId":null,"aiProfileId":"removed-model"}\n', "utf8");
    expect(await new AppStateStore(file).load()).toEqual({
      lastCourseId: null,
      aiProfileId: "codex-terra-medium",
    });
  });

  it("serializes partial profile and course updates without losing either field", async () => {
    const file = await makePath();
    const store = new AppStateStore(file);

    await Promise.all([
      store.update({ lastCourseId: "js-fetch" }),
      store.update({ aiProfileId: "codex-sol-xhigh" }),
    ]);

    expect(await store.load()).toEqual({
      lastCourseId: "js-fetch",
      aiProfileId: "codex-sol-xhigh",
    });
  });
});
