(() => {
  const storageKey = "adaptive-learning-theme";
  const validThemes = new Set(["light", "dark"]);
  let stored = null;

  try {
    const value = window.localStorage.getItem(storageKey);
    if (validThemes.has(value)) stored = value;
  } catch {
    stored = null;
  }

  let systemDark = false;
  try {
    systemDark = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    systemDark = false;
  }

  const theme = stored ?? (systemDark ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
