import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlaylistStateStore } from "../src/persistence/playlist-state-store.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "playlist-state-"));
  directories.push(directory);
  const statePath = path.join(directory, "data", "playlist-state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  return { directory, statePath, store: new PlaylistStateStore(statePath) };
}

describe("PlaylistStateStore", () => {
  it("reads missing navigation without creating its file", async () => {
    const { statePath, store } = await makeStore();
    await expect(store.load()).resolves.toEqual({ schemaVersion: 1, playlists: {} });
    await expect(fs.access(statePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps independent selections when updates and archive run concurrently", async () => {
    const { statePath, store } = await makeStore();
    await Promise.all([
      store.select("playlist-a", "lesson-a", { openedAt: "2026-10-12T10:00:00.000Z" }),
      store.select("playlist-b", "lesson-b", { openedAt: "2026-10-12T10:01:00.000Z" }),
      store.setArchived("playlist-a", true),
    ]);

    expect(await store.get("playlist-a")).toEqual({
      lastLessonCourseId: "lesson-a",
      lastOpenedAt: "2026-10-12T10:00:00.000Z",
      archived: true,
    });
    expect(await store.get("playlist-b")).toEqual({
      lastLessonCourseId: "lesson-b",
      lastOpenedAt: "2026-10-12T10:01:00.000Z",
      archived: false,
    });
    expect(await new PlaylistStateStore(statePath).load()).toEqual(await store.load());
  });

  it("creates an empty navigation entry on first archive without selecting a lesson", async () => {
    const { store } = await makeStore();
    await store.setArchived("playlist-a", true);
    expect(await store.get("playlist-a")).toEqual({
      lastLessonCourseId: null,
      lastOpenedAt: null,
      archived: true,
    });
  });

  it("rejects corrupt and unknown state without replacing its bytes", async () => {
    const { statePath, store } = await makeStore();
    const corrupt = Buffer.from('{"schemaVersion":1,"playlists":{"playlist-a":{"unexpected":true}}}');
    await fs.writeFile(statePath, corrupt);
    await expect(store.load()).rejects.toMatchObject({ category: "playlist-navigation-unavailable" });
    expect(await fs.readFile(statePath)).toEqual(corrupt);
  });

  it("preserves the previous state when writing the temporary sibling fails", async () => {
    const { statePath, store } = await makeStore();
    await store.select("playlist-a", "lesson-a", { openedAt: "2026-10-12T10:00:00.000Z" });
    const before = await fs.readFile(statePath);
    await fs.mkdir(`${statePath}.tmp`);

    await expect(store.setArchived("playlist-a", true)).rejects.toThrow();
    expect(await fs.readFile(statePath)).toEqual(before);
  });

  it("rejects invalid identifiers, unknown fields and non-ISO open times", async () => {
    const { statePath, store } = await makeStore();
    expect(() => store.select("../playlist", "lesson-a", { openedAt: "2026-10-12T10:00:00.000Z" })).toThrow();
    expect(() => store.select("playlist-a", "lesson-a", { openedAt: "tomorrow" })).toThrow();
    const unknown = Buffer.from('{"schemaVersion":1,"playlists":{},"secret":"value"}');
    await fs.writeFile(statePath, unknown);
    await expect(store.load()).rejects.toMatchObject({ category: "playlist-navigation-unavailable" });
    expect(await fs.readFile(statePath)).toEqual(unknown);
  });
});
