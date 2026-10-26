import { describe, expect, it } from "vitest";
import { CatalogSchema, serializeCatalog } from "../src/domain/course-catalog-schema.js";

function makeCatalog() {
  return {
    schemaVersion: 1,
    courses: [
      { id: "build-skills", order: 1, title: "Build skills", summary: "Навыки Codex из официальной статьи." },
      { id: "js-fetch", order: 2, title: "JS Fetch", summary: "Практические запросы к внешнему API." },
      { id: "best-practices", order: 3, title: "Best practices for Codex", summary: "Завершённая статья о работе с Codex." },
    ],
  };
}

describe("CatalogSchema", () => {
  it("accepts unique courses in sequential order", () => {
    expect(CatalogSchema.parse(makeCatalog()).courses.map(({ id }) => id))
      .toEqual(["build-skills", "js-fetch", "best-practices"]);
  });

  it("rejects duplicate course ids", () => {
    const catalog = makeCatalog();
    catalog.courses[1].id = "build-skills";

    expect(() => CatalogSchema.parse(catalog)).toThrow("Duplicate course id");
  });

  it("rejects a gap in published order", () => {
    const catalog = makeCatalog();
    catalog.courses[1].order = 3;

    expect(() => CatalogSchema.parse(catalog)).toThrow("Courses must be sequential");
  });

  it("rejects unsafe course ids", () => {
    const catalog = makeCatalog();
    catalog.courses[0].id = "../secret";

    expect(() => CatalogSchema.parse(catalog)).toThrow();
  });

  it("defaults archived to false when the field is absent", () => {
    const parsed = CatalogSchema.parse(makeCatalog());
    expect(parsed.courses.every((course) => course.archived === false)).toBe(true);
  });

 it("accepts an explicitly archived course", () => {
   const catalog = makeCatalog();
   catalog.courses[1].archived = true;
   const parsed = CatalogSchema.parse(catalog);
   expect(parsed.courses[1].archived).toBe(true);
   expect(parsed.courses[0].archived).toBe(false);
 });

 it("serializeCatalog wraps courses with schemaVersion 1", () => {
   const catalog = serializeCatalog([{ id: "a", order: 1, title: "A", summary: "Summary here." }]);
   expect(catalog).toEqual({
     schemaVersion: 1,
     courses: [{ id: "a", order: 1, title: "A", summary: "Summary here." }],
   });
 });
});
