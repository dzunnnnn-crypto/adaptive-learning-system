import fs from "node:fs/promises";
import path from "node:path";
import { CatalogSchema, serializeCatalog } from "../domain/course-catalog-schema.js";

function courseNotFound() {
  return Object.assign(new Error("Unknown course id"), { category: "course-not-found" });
}

export class CatalogRepository {
  constructor({ coursesRoot, catalogPath }) {
    this.coursesRoot = path.resolve(coursesRoot);
    this.catalogPath = path.resolve(catalogPath);
    this.entries = null;
    this.fileSignature = null;
    this.tail = Promise.resolve();
  }

  async signature() {
    const stat = await fs.stat(this.catalogPath, { bigint: true });
    return [stat.mtimeNs, stat.ctimeNs, stat.size].join(":");
  }

  async load() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.signature();
      if (this.entries && before === this.fileSignature) return this.entries;

      const catalog = CatalogSchema.parse(JSON.parse(await fs.readFile(this.catalogPath, "utf8")));
      const after = await this.signature();
      if (before !== after) continue;

      this.entries = catalog.courses;
      this.fileSignature = after;
      return this.entries;
    }

    throw new Error("Catalog changed repeatedly while being read");
  }

  async list() {
    return this.enqueue(async () => [...await this.load()]);
  }

  async get(courseId) {
    return this.enqueue(async () => {
      await this.load();
      return this.requireEntry(courseId);
    });
  }

  enqueue(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => {});
    return result;
  }

  async persist() {
    this.fileSignature = null;
    const catalog = serializeCatalog(this.entries);
    CatalogSchema.parse(catalog);
    const tempPath = `${this.catalogPath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.catalogPath);
  }

  async setArchived(courseId, archived) {
    return this.enqueue(async () => {
      await this.load();
      const entry = this.requireEntry(courseId);
      entry.archived = archived;
      await this.persist();
      return { ...entry };
    });
  }

  requireEntry(courseId) {
    const entry = this.entries?.find((candidate) => candidate.id === courseId);
    if (!entry) throw courseNotFound();
    return entry;
  }

  coursePath(courseId) {
    const entry = this.requireEntry(courseId);
    return path.join(this.coursesRoot, entry.id, "course.json");
  }

  memoryPath(courseId) {
    const entry = this.requireEntry(courseId);
    return path.join(this.coursesRoot, entry.id, "learning_memory.md");
  }
}
