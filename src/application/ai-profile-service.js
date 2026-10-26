import {
  publicAiProfiles,
  requireAiProfile,
} from "../ai/ai-profile-registry.js";

function profileUnavailable() {
  return Object.assign(new Error("Z.AI key is missing"), {
    category: "zai-key-missing",
  });
}

export class AiProfileService {
  constructor({ appStateStore, zaiApiKey = null }) {
    this.appStateStore = appStateStore;
    this.hasZaiKey = Boolean(String(zaiApiKey ?? "").trim());
  }

  assertAvailable(profile) {
    if (profile.provider === "zai" && !this.hasZaiKey) throw profileUnavailable();
  }

  async getPublicState() {
    const state = await this.appStateStore.load();
    return {
      selectedProfileId: state.aiProfileId,
      profiles: publicAiProfiles({ hasZaiKey: this.hasZaiKey }),
    };
  }

  async getSelectedProfile() {
    const { aiProfileId } = await this.appStateStore.load();
    const profile = requireAiProfile(aiProfileId);
    this.assertAvailable(profile);
    return profile;
  }

  async select(profileId) {
    const profile = requireAiProfile(profileId);
    this.assertAvailable(profile);
    await this.appStateStore.update({ aiProfileId: profile.id });
    return this.getPublicState();
  }
}
