export function createProviderRouter({ profileService, providerFactories }) {
  const providers = new Map();

  return {
    async generate(prompt, expectedKind) {
      const profile = await profileService.getSelectedProfile();
      if (!providers.has(profile.id)) {
        const factory = providerFactories[profile.provider];
        if (!factory) {
          throw Object.assign(new Error("AI provider is unavailable"), {
            category: "unavailable",
          });
        }
        providers.set(profile.id, factory(profile));
      }

      const result = await providers.get(profile.id).generate(prompt, expectedKind);
      return {
        ...result,
        generatedBy: {
          profileId: profile.id,
          label: profile.label,
        },
      };
    },
  };
}
