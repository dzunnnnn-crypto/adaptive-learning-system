import { describe, expect, it, vi } from "vitest";

const terra = {
  id: "codex-terra-medium",
  label: "Codex · Terra · Medium",
  provider: "codex",
};
const sol = {
  id: "codex-sol-xhigh",
  label: "Codex · Sol · Very High",
  provider: "codex",
};
const glm = {
  id: "zai-glm-5-2-max",
  label: "GLM · 5.2 · Max",
  provider: "zai",
};

const detail = {
  kind: "detail",
  explanation: "Подробное объяснение учебного материала для проверки маршрутизации.",
  example: "Конкретный пример работы выбранного профиля.",
  caveat: "Важно проверять сохранённую подпись профиля.",
};

async function createRouter(options) {
  const { createProviderRouter } = await import("../src/ai/provider-router.js");
  return createProviderRouter(options);
}

describe("AI provider router", () => {
  it("snapshots the selected profile on every request and adds trusted attribution", async () => {
    const terraProvider = { generate: vi.fn().mockResolvedValue(detail) };
    const solProvider = { generate: vi.fn().mockResolvedValue(detail) };
    const glmProvider = { generate: vi.fn().mockResolvedValue(detail) };
    const codexFactory = vi.fn((profile) => profile.id === terra.id ? terraProvider : solProvider);
    const zaiFactory = vi.fn(() => glmProvider);
    const profileService = {
      getSelectedProfile: vi.fn()
        .mockResolvedValueOnce(terra)
        .mockResolvedValueOnce(sol)
        .mockResolvedValueOnce(glm),
    };
    const router = await createRouter({
      profileService,
      providerFactories: { codex: codexFactory, zai: zaiFactory },
    });

    await expect(router.generate("one", "detail")).resolves.toMatchObject({
      generatedBy: { profileId: terra.id, label: terra.label },
    });
    await expect(router.generate("two", "detail")).resolves.toMatchObject({
      generatedBy: { profileId: sol.id, label: sol.label },
    });
    await expect(router.generate("three", "detail")).resolves.toMatchObject({
      generatedBy: { profileId: glm.id, label: glm.label },
    });

    expect(codexFactory).toHaveBeenCalledWith(terra);
    expect(codexFactory).toHaveBeenCalledWith(sol);
    expect(zaiFactory).toHaveBeenCalledWith(glm);
    expect(terraProvider.generate).toHaveBeenCalledWith("one", "detail");
    expect(solProvider.generate).toHaveBeenCalledWith("two", "detail");
    expect(glmProvider.generate).toHaveBeenCalledWith("three", "detail");
  });

  it("caches a provider per profile without changing attribution", async () => {
    const provider = { generate: vi.fn().mockResolvedValue(detail) };
    const factory = vi.fn(() => provider);
    const router = await createRouter({
      profileService: { getSelectedProfile: vi.fn().mockResolvedValue(terra) },
      providerFactories: { codex: factory },
    });

    await router.generate("one", "detail");
    await router.generate("two", "detail");

    expect(factory).toHaveBeenCalledTimes(1);
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to another provider after a selected-profile failure", async () => {
    const selectedFailure = Object.assign(new Error("selected provider failed"), {
      category: "zai-unavailable",
    });
    const zaiFactory = vi.fn(() => ({ generate: vi.fn().mockRejectedValue(selectedFailure) }));
    const codexFactory = vi.fn();
    const router = await createRouter({
      profileService: { getSelectedProfile: vi.fn().mockResolvedValue(glm) },
      providerFactories: { codex: codexFactory, zai: zaiFactory },
    });

    await expect(router.generate("one", "detail")).rejects.toBe(selectedFailure);
    expect(codexFactory).not.toHaveBeenCalled();
  });
});
