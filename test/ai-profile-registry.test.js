import { describe, expect, it } from "vitest";

async function loadRegistry() {
  return import("../src/ai/ai-profile-registry.js");
}

describe("AI profile registry", () => {
  it("defines the four approved profiles and Terra Medium default", async () => {
    const {
      AI_PROFILES,
      DEFAULT_AI_PROFILE_ID,
      requireAiProfile,
    } = await loadRegistry();

    expect(DEFAULT_AI_PROFILE_ID).toBe("codex-terra-medium");
    expect(AI_PROFILES.map(({ id }) => id)).toEqual([
      "codex-terra-medium",
      "codex-luna-high",
      "codex-sol-xhigh",
      "zai-glm-5-2-max",
      "zai-glm-5-turbo",
    ]);
    expect(requireAiProfile("codex-terra-medium")).toMatchObject({
      label: "Codex · Terra · Medium",
      provider: "codex",
      model: "gpt-5.6-terra",
      modelReasoningEffort: "medium",
      timeoutMs: 90_000,
    });
    expect(requireAiProfile("codex-luna-high")).toMatchObject({
      label: "Codex · Luna · High",
      provider: "codex",
      model: "gpt-5.6-luna",
      modelReasoningEffort: "high",
      timeoutMs: 90_000,
    });
    expect(requireAiProfile("codex-sol-xhigh")).toMatchObject({
      label: "Codex · Sol · Very High",
      provider: "codex",
      model: "gpt-5.6-sol",
      modelReasoningEffort: "xhigh",
      timeoutMs: 90_000,
    });
    expect(requireAiProfile("zai-glm-5-2-max")).toMatchObject({
      label: "GLM · 5.2 · Max",
      provider: "zai",
      model: "glm-5.2",
      reasoningEffort: "max",
      thinkingEnabled: true,
      timeoutMs: 240_000,
    });
    expect(requireAiProfile("zai-glm-5-turbo")).toMatchObject({
      label: "GLM · 5-Turbo",
      provider: "zai",
      model: "glm-5-turbo",
      reasoningEffort: null,
      thinkingEnabled: true,
      timeoutMs: 180_000,
    });
  });

  it("keeps unavailable GLM profiles visible without exposing configuration", async () => {
    const { publicAiProfiles } = await loadRegistry();

    const profiles = publicAiProfiles({ hasZaiKey: false });
    const glm = profiles.filter((profile) => profile.provider === "zai");

    expect(glm).toEqual([
      {
        id: "zai-glm-5-2-max",
        label: "GLM · 5.2 · Max",
        provider: "zai",
        available: false,
        unavailableReason: "Добавь ZAI_API_KEY в .env.local",
      },
      {
        id: "zai-glm-5-turbo",
        label: "GLM · 5-Turbo",
        provider: "zai",
        available: false,
        unavailableReason: "Добавь ZAI_API_KEY в .env.local",
      },
    ]);
    expect(profiles.flatMap((profile) => Object.keys(profile)))
      .not.toEqual(expect.arrayContaining([
        "model",
        "timeoutMs",
        "endpoint",
        "apiKey",
      ]));
  });

  it("rejects an unknown profile instead of silently falling back", async () => {
    const { requireAiProfile } = await loadRegistry();

    let error;
    try {
      requireAiProfile("custom-model");
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      category: "ai-profile-not-found",
    });
  });
});
