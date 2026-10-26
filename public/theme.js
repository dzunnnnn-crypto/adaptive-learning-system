export const THEME_STORAGE_KEY = "adaptive-learning-theme";

const VALID_THEMES = new Set(["light", "dark"]);
const controllers = new WeakMap();

function safeBrowserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeBrowserMedia() {
  try {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  } catch {
    return null;
  }
}

export function readStoredTheme(storage) {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.has(value) ? value : null;
  } catch {
    return null;
  }
}

export function systemTheme(media) {
  return media?.matches ? "dark" : "light";
}

export function applyTheme({ root, button, theme }) {
  const nextTheme = VALID_THEMES.has(theme) ? theme : "light";
  root.dataset.theme = nextTheme;
  root.style.colorScheme = nextTheme;

  if (!button) return nextTheme;
  const dark = nextTheme === "dark";
  const nextLabel = dark ? "Включить светлую тему" : "Включить тёмную тему";
  button.setAttribute("aria-label", nextLabel);
  button.title = nextLabel;
  const icon = button.querySelector("[data-theme-icon]");
  if (icon) icon.textContent = dark ? "☀" : "☾";
  return nextTheme;
}

export function initThemeControl({
  root = document.documentElement,
  button = document.querySelector("[data-role=theme-toggle]"),
  storage = undefined,
  media = undefined,
} = {}) {
  const existing = controllers.get(root);
  if (existing) return existing;

  const resolvedStorage = storage === undefined ? safeBrowserStorage() : storage;
  const resolvedMedia = media === undefined ? safeBrowserMedia() : media;
  const stored = readStoredTheme(resolvedStorage);
  let manualChoice = stored !== null;
  let current = stored
    ?? (VALID_THEMES.has(root.dataset.theme) ? root.dataset.theme : systemTheme(resolvedMedia));

  current = applyTheme({ root, button, theme: current });

  const onToggle = () => {
    manualChoice = true;
    current = applyTheme({
      root,
      button,
      theme: current === "dark" ? "light" : "dark",
    });
    try {
      resolvedStorage?.setItem(THEME_STORAGE_KEY, current);
    } catch {
      // The manual choice remains active for this page even when storage is blocked.
    }
  };

  const onSystemChange = (event) => {
    if (manualChoice) return;
    current = applyTheme({
      root,
      button,
      theme: event.matches ? "dark" : "light",
    });
  };

  button?.addEventListener("click", onToggle);
  resolvedMedia?.addEventListener?.("change", onSystemChange);

  const controller = {
    getTheme: () => current,
    destroy() {
      button?.removeEventListener("click", onToggle);
      resolvedMedia?.removeEventListener?.("change", onSystemChange);
      controllers.delete(root);
    },
  };
  controllers.set(root, controller);
  return controller;
}
