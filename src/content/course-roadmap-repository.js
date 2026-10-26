import fs from "node:fs/promises";
import { CourseRoadmapsSchema } from "../domain/course-roadmap-schema.js";

export class CourseRoadmapRepository {
  constructor({ roadmapsPath }) {
    this.roadmapsPath = roadmapsPath;
    this.roadmaps = null;
    this.fileSignature = null;
  }

  async signature() {
    const stat = await fs.stat(this.roadmapsPath, { bigint: true });
    return [stat.mtimeNs, stat.ctimeNs, stat.size].join(":");
  }

  async load() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.signature();
      if (this.roadmaps && before === this.fileSignature) return this.roadmaps;

      let document;
      try {
        document = CourseRoadmapsSchema.parse(JSON.parse(
          await fs.readFile(this.roadmapsPath, "utf8"),
        ));
      } catch (error) {
        if (before !== await this.signature()) continue;
        throw error;
      }

      const after = await this.signature();
      if (before !== after) continue;
      this.roadmaps = document.roadmaps;
      this.fileSignature = after;
      return this.roadmaps;
    }

    throw new Error("Roadmap changed repeatedly while being read");
  }

  async list() {
    return structuredClone(await this.load());
  }

  async forCourse(courseId) {
    const roadmap = (await this.load()).find((candidate) => candidate.sections
      .some((section) => section.items.some((item) => item.courseId === courseId)));
    return roadmap ? structuredClone(roadmap) : null;
  }
}
