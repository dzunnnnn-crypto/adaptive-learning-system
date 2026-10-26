import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppStateStore } from "../src/persistence/app-state-store.js";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-profile-service-"));
  directories.push(root);
  return new AppStateStore(path.join(root, "data", "app-state.json"));
}

async function createService(options = {}) {
  const { AiProfileService } = await import("../src/application/ai-profile-service.js");
  return new AiProfileService({ appStateStore: await makeStore(), ...options });
}

describe("AiProfileService", () => {
  it("returns Terra Medium as the default public selection", async () => {
    const service = await createService();

    await expect(service.getPublicState()).resolves.toEqual({
      selectedProfileId: "codex-terra-medium",
      profiles: expect.arrayContaining([
        expect.objectContaining({ id: "codex-terra-medium", available: true }),
        expect.objectContaining({ id: "zai-glm-5-2-max", available: false }),
      ]),
    });
  });

  it("persists an available Codex selection without changing the last course", async () => {
    const service = await createService();
    await service.appStateStore.update({ lastCourseId: "js-fetch" });

    await service.select("codex-sol-xhigh");

    expect(await service.appStateStore.load()).toEqual({
      lastCourseId: "js-fetch",
      aiProfileId: "codex-sol-xhigh",
    });
  });

  it("rejects unavailable and unknown profile selections without changing state", async () => {
    const service = await createService();

    await expect(service.select("zai-glm-5-2-max"))
      .rejects.toMatchObject({ category: "zai-key-missing" });
    await expect(service.select("custom-model"))
      .rejects.toMatchObject({ category: "ai-profile-not-found" });
    expect((await service.appStateStore.load()).aiProfileId).toBe("codex-terra-medium");
  });

  it("keeps a previously selected GLM visible but blocks its provider without a key", async () => {
    const service = await createService();
    await service.appStateStore.update({ aiProfileId: "zai-glm-5-2-max" });

    const publicState = await service.getPublicState();
    expect(publicState.selectedProfileId).toBe("zai-glm-5-2-max");
    expect(publicState.profiles.find((profile) => profile.id === "zai-glm-5-2-max"))
      .toMatchObject({ available: false });
    await expect(service.getSelectedProfile())
      .rejects.toMatchObject({ category: "zai-key-missing" });
  });
});
