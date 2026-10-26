import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";

let source;
let html;

beforeEach(async () => {
  [source, html] = await Promise.all([
    fs.readFile("public/theme-boot.js", "utf8"),
    fs.readFile("public/index.html", "utf8"),
  ]);
});

function boot({ saved = null, systemDark = false, storageThrows = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://127.0.0.1:4173",
    runScripts: "outside-only",
  });
  const { window } = dom;
  window.matchMedia = vi.fn(() => ({ matches: systemDark }));
  if (saved !== null) window.localStorage.setItem("adaptive-learning-theme", saved);
  if (storageThrows) {
    window.Storage.prototype.getItem = vi.fn(() => { throw new Error("blocked"); });
  }
  window.eval(source);
  return window.document.documentElement;
}

describe("early theme boot", () => {
  it("runs before the stylesheet is requested", () => {
    expect(html.indexOf('<script src="/theme-boot.js"></script>'))
      .toBeGreaterThan(-1);
    expect(html.indexOf('<script src="/theme-boot.js"></script>'))
      .toBeLessThan(html.indexOf('<link rel="stylesheet" href="/styles.css">'));
  });

  it("uses a valid saved choice before system preference", () => {
    const root = boot({ saved: "light", systemDark: true });
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("uses the system dark theme without a saved choice", () => {
    expect(boot({ systemDark: true }).dataset.theme).toBe("dark");
  });

  it("ignores an invalid saved value", () => {
    expect(boot({ saved: "sepia", systemDark: true }).dataset.theme).toBe("dark");
  });

  it("falls back to the system theme when storage is blocked", () => {
    expect(boot({ systemDark: true, storageThrows: true }).dataset.theme).toBe("dark");
  });

  it("contains an accessible theme button outside lesson actions", () => {
    const document = new JSDOM(html).window.document;
    const button = document.querySelector('[data-role="theme-toggle"]');
    expect(button).not.toBeNull();
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Включить тёмную тему");
    expect(button.querySelector("[data-theme-icon]").getAttribute("aria-hidden")).toBe("true");
    expect(button.dataset.action).toBeUndefined();
  });
});
