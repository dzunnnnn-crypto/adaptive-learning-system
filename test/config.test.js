import { describe, expect, it } from "vitest";
import { createConfig } from "../src/config.js";

describe("createConfig", () => {
  it("binds to localhost and resolves project paths", () => {
    const config = createConfig({ PORT: "4312", PROJECT_ROOT: "C:\\course" });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(4312);
    expect(config.projectRoot).toBe("C:\\course");
    expect(config.coursesRoot).toBe("C:\\course\\courses");
    expect(config.catalogPath).toBe("C:\\course\\courses\\catalog.json");
    expect(config.roadmapsPath).toBe("C:\\course\\courses\\roadmaps.json");
    expect(config.appStatePath).toBe("C:\\course\\data\\app-state.json");
    expect(config.playlistStatePath).toBe("C:\\course\\data\\playlist-state.json");
    expect(config.publicPath).toBe("C:\\course\\public");
    expect(config.zaiApiKey).toBeNull();
  });

  it("allows selecting isolated library paths", () => {
    const config = createConfig({
      PORT: "4312",
      PROJECT_ROOT: "C:\\course",
      COURSES_ROOT: "data\\smoke-courses",
      CATALOG_PATH: "data\\smoke-courses\\catalog.json",
      ROADMAPS_PATH: "data\\smoke-courses\\roadmaps.json",
      APP_STATE_PATH: "data\\smoke-app-state.json",
      PLAYLIST_STATE_PATH: "data\\smoke-playlist-state.json",
    });

    expect(config.coursesRoot).toBe("C:\\course\\data\\smoke-courses");
    expect(config.catalogPath).toBe("C:\\course\\data\\smoke-courses\\catalog.json");
    expect(config.roadmapsPath).toBe("C:\\course\\data\\smoke-courses\\roadmaps.json");
    expect(config.appStatePath).toBe("C:\\course\\data\\smoke-app-state.json");
    expect(config.playlistStatePath).toBe("C:\\course\\data\\smoke-playlist-state.json");
    expect(config.playlistStatePath).not.toBe("C:\\course\\data\\playlist-state.json");
  });

  it("rejects an invalid port", () => {
    expect(() => createConfig({ PORT: "abc", PROJECT_ROOT: "C:\\course" }))
      .toThrow("PORT must be an integer from 1 to 65535");
  });

  it("trims a local Z.AI key without exposing it elsewhere in config", () => {
    const config = createConfig({
      PROJECT_ROOT: "C:\\course",
      ZAI_API_KEY: "  test-key  ",
    });

    expect(config.zaiApiKey).toBe("test-key");
  });
});
