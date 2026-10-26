import fs from "node:fs/promises";
import { CourseSchema } from "../domain/course-schema.js";

export async function loadCourse(coursePath) {
  const raw = await fs.readFile(coursePath, "utf8");
  const course = CourseSchema.parse(JSON.parse(raw));
  if (course.source.status !== "verified") {
    throw new Error("Course source requires review before activation");
  }
  return course;
}
