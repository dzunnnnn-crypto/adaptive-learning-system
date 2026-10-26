export const DEFAULT_AI_PROFILE_ID = "codex-terra-medium";

function profile(definition) {
  return Object.freeze(definition);
}

export const AI_PROFILES = Object.freeze([
  profile({
    id: "codex-terra-medium",
    label: "Codex · Terra · Medium",
    provider: "codex",
    model: "gpt-5.6-terra",
    modelReasoningEffort: "medium",
    timeoutMs: 90_000,
  }),
  profile({
    id: "codex-luna-high",
    label: "Codex · Luna · High",
    provider: "codex",
    model: "gpt-5.6-luna",
    modelReasoningEffort: "high",
    timeoutMs: 90_000,
  }),
  profile({
    id: "codex-sol-xhigh",
    label: "Codex · Sol · Very High",
    provider: "codex",
    model: "gpt-5.6-sol",
    modelReasoningEffort: "xhigh",
    timeoutMs: 90_000,
  }),
  profile({
    id: "zai-glm-5-2-max",
    label: "GLM · 5.2 · Max",
    provider: "zai",
    model: "glm-5.2",
    reasoningEffort: "max",
    thinkingEnabled: true,
    timeoutMs: 240_000,
  }),
  profile({
    id: "zai-glm-5-turbo",
    label: "GLM · 5-Turbo",
    provider: "zai",
    model: "glm-5-turbo",
    reasoningEffort: null,
    thinkingEnabled: true,
    timeoutMs: 180_000,
  }),
]);

const profilesById = new Map(AI_PROFILES.map((item) => [item.id, item]));

export function isKnownAiProfileId(profileId) {
  return profilesById.has(profileId);
}

export function requireAiProfile(profileId) {
  const selected = profilesById.get(profileId);
  if (selected) return selected;

  throw Object.assign(new Error("Unknown AI profile"), {
    category: "ai-profile-not-found",
  });
}

export function publicAiProfiles({ hasZaiKey }) {
  return AI_PROFILES.map((item) => {
    const available = item.provider !== "zai" || hasZaiKey;
    return {
      id: item.id,
      label: item.label,
      provider: item.provider,
      available,
      unavailableReason: available ? null : "Добавь ZAI_API_KEY в .env.local",
    };
  });
}
