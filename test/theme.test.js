import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  initThemeControl,
  readStoredTheme,
  systemTheme,
} from "../public/theme.js";

function createMedia(matches = false) {
  const listeners = new Set();
  return {
    matches,
    addEventListener: vi.fn((name, listener) => {
      if (name === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((name, listener) => {
      if (name === "change") listeners.delete(listener);
    }),
    emit(nextMatches) {
      this.matches = nextMatches;
      for (const listener of listeners) listener({ matches: nextMatches });
    },
  };
}

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((key, nextValue) => {
      expect(key).toBe(THEME_STORAGE_KEY);
      value = nextValue;
    }),
  };
}

let document;
let root;
let button;

beforeEach(() => {
  document = new JSDOM(`<!doctype html><html><body>
    <button type="button" data-role="theme-toggle">
      <span data-theme-icon aria-hidden="true">☾</span>
    </button>
  </body></html>`).window.document;
  root = document.documentElement;
  button = document.querySelector("[data-role=theme-toggle]");
});

describe("theme controller", () => {
  it("accepts only light and dark stored values", () => {
    expect(readStoredTheme(createStorage("dark"))).toBe("dark");
    expect(readStoredTheme(createStorage("light"))).toBe("light");
    expect(readStoredTheme(createStorage("sepia"))).toBeNull();
    expect(readStoredTheme(null)).toBeNull();
  });

  it("prefers a saved choice over the system theme", () => {
    initThemeControl({ root, button, storage: createStorage("light"), media: createMedia(true) });
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("uses the system theme when there is no saved choice", () => {
    expect(systemTheme(createMedia(true))).toBe("dark");
    initThemeControl({ root, button, storage: createStorage(), media: createMedia(true) });
    expect(root.dataset.theme).toBe("dark");
    expect(button.getAttribute("aria-label")).toBe("Включить светлую тему");
    expect(button.querySelector("[data-theme-icon]").textContent).toBe("☀");
  });

  it("switches immediately, updates accessible text, and saves the manual choice", () => {
    const storage = createStorage();
    initThemeControl({ root, button, storage, media: createMedia(false) });
    button.click();
    expect(root.dataset.theme).toBe("dark");
    expect(button.getAttribute("aria-label")).toBe("Включить светлую тему");
    expect(button.title).toBe("Включить светлую тему");
    expect(button.querySelector("[data-theme-icon]").textContent).toBe("☀");
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
  });

  it("keeps switching for the current page when storage throws", () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
    };
    initThemeControl({ root, button, storage, media: createMedia(false) });
    button.click();
    expect(root.dataset.theme).toBe("dark");
  });

  it("follows system changes only until the first manual choice", () => {
    const media = createMedia(false);
    initThemeControl({ root, button, storage: createStorage(), media });
    media.emit(true);
    expect(root.dataset.theme).toBe("dark");
    button.click();
    expect(root.dataset.theme).toBe("light");
    media.emit(true);
    expect(root.dataset.theme).toBe("light");
  });

  it("does not register duplicate handlers for the same root", () => {
    const storage = createStorage();
    const media = createMedia(false);
    const first = initThemeControl({ root, button, storage, media });
    const second = initThemeControl({ root, button, storage, media });
    expect(second).toBe(first);
    button.click();
    expect(root.dataset.theme).toBe("dark");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("removes listeners when destroyed", () => {
    const media = createMedia(false);
    const controller = initThemeControl({ root, button, storage: createStorage(), media });
    controller.destroy();
    button.click();
    media.emit(true);
    expect(root.dataset.theme).toBe("light");
    expect(media.removeEventListener).toHaveBeenCalledOnce();
  });

  it("applies a theme without requiring a button", () => {
    applyTheme({ root, button: null, theme: "dark" });
    expect(root.dataset.theme).toBe("dark");
  });
});
