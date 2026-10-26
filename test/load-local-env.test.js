import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories = [];
const variable = "ADAPTIVE_LEARNING_TEST_LOCAL_ENV";

afterEach(async () => {
  delete process.env[variable];
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adaptive-local-env-"));
  directories.push(directory);
  return directory;
}

describe("loadLocalEnv", () => {
  it("does nothing when this project's .env.local is absent", async () => {
    const { loadLocalEnv } = await import("../src/load-local-env.js");
    const directory = await makeDirectory();

    expect(loadLocalEnv(directory)).toBe(false);
  });

  it("loads only a .env.local from the supplied project root", async () => {
    const { loadLocalEnv } = await import("../src/load-local-env.js");
    const directory = await makeDirectory();
    await fs.writeFile(path.join(directory, ".env.local"), `${variable}=loaded\n`, "utf8");

    expect(loadLocalEnv(directory)).toBe(true);
    expect(process.env[variable]).toBe("loaded");
  });
});
