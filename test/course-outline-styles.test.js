import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("course outline CSS contract", () => {
  it("defines desktop drawer and mobile full-screen behavior", async () => {
    const css = await fs.readFile("public/styles.css", "utf8");
    expect(css).toContain(".outline-overlay");
    expect(css).toContain("grid-template-columns: 1fr minmax(360px, 520px)");
    expect(css).toContain(".outline-drawer");
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(mobile).toContain(".outline-overlay");
    expect(mobile).toContain("display: block");
    expect(mobile).toContain(".outline-backdrop");
    expect(mobile).toContain("display: none");
  });
});
