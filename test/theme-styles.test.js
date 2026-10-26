import fs from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

let css;

beforeAll(async () => {
  css = await fs.readFile("public/styles.css", "utf8");
});

describe("theme CSS contract", () => {
  it("defines every semantic surface token for both themes", () => {
    for (const token of [
      "--body",
      "--field",
      "--header",
      "--header-line",
      "--shadow",
      "--on-accent",
      "--danger-line",
      "--user-message",
    ]) {
      expect(css).toContain(`${token}:`);
    }
    expect(css).toContain('[data-theme="dark"]');
  });

  it("contains the approved graphite and sage palette", () => {
    for (const declaration of [
      "--canvas: #181d1b;",
      "--paper: #222825;",
      "--soft: #29302c;",
      "--ink: #f0f1ec;",
      "--body: #c3cac5;",
      "--muted: #87938c;",
      "--line: #3a4540;",
      "--line-strong: #536159;",
      "--accent: #75a991;",
      "--accent-dark: #8fc1a8;",
      "--accent-soft: #293b33;",
      "--danger: #f0a7a1;",
      "--danger-soft: #3b2828;",
      "--field: #191e1c;",
      "--header: rgba(24, 29, 27, 0.94);",
      "--shadow: rgba(0, 0, 0, 0.28);",
    ]) {
      expect(css).toContain(declaration);
    }
  });

  it("uses semantic tokens instead of component-local neutral colors", () => {
    expect(css).toContain("background: var(--header);");
    expect(css).toContain("border-bottom: 1px solid var(--header-line);");
    expect(css).toContain("box-shadow: 0 20px 55px var(--shadow);");
    expect(css).toContain("color: var(--body);");
    expect(css).toContain("background: var(--field);");
    expect(css).toContain("color: var(--on-accent);");
    expect(css).toContain("border: 1px solid var(--danger-line);");
    expect(css).toContain("background: var(--user-message);");
    expect(css).not.toContain("background: white;");
    expect(css).not.toContain("color: white;");
    expect(css).not.toContain("color: #343a35;");
    expect(css).not.toContain("border: 1px solid #ddb7b0;");
    expect(css).not.toContain("background: #eef0ec;");
  });

  it("lays out the theme control on desktop and mobile", () => {
    expect(css).toContain(".header-controls {");
    expect(css).toContain(".theme-toggle {");
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(mobile).toContain(".header-controls {");
  });
});
