import path from "node:path";
import { createConfig } from "../src/config.js";
import { CatalogRepository } from "../src/content/catalog-repository.js";
import { CourseRoadmapRepository } from "../src/content/course-roadmap-repository.js";
import { validateCourseAssets } from "../src/content/course-assets.js";
import { loadCourse } from "../src/content/course-repository.js";

const config = createConfig();
const catalog = new CatalogRepository({
  coursesRoot: config.coursesRoot,
  catalogPath: config.catalogPath,
});
const roadmaps = new CourseRoadmapRepository({ roadmapsPath: config.roadmapsPath });

const entries = await catalog.list();
const courseIds = new Set(entries.map((entry) => entry.id));
const roadmapEntries = await roadmaps.list();
for (const roadmap of roadmapEntries) {
  for (const section of roadmap.sections) {
    for (const item of section.items) {
      if (item.courseId && !courseIds.has(item.courseId)) {
        throw new Error(`Roadmap ${roadmap.id} references unknown course ${item.courseId}`);
      }
    }
  }
}
console.log(`Validated ${roadmapEntries.length} course roadmaps`);

for (const entry of entries) {
  const course = await loadCourse(catalog.coursePath(entry.id));
  const assets = await validateCourseAssets({
    course,
    courseDirectory: path.dirname(catalog.coursePath(entry.id)),
  });
  const subtitleInfo = assets.checkedSubtitleFiles
    ? `, ${assets.checkedSubtitleFiles} subtitles (${assets.subtitleBytes} bytes)`
    : "";
  console.log(`Validated ${course.id}@${course.contentVersion}: ${course.units.length} units, ${course.coverage.length} coverage rows, ${assets.checkedFiles} files (${assets.totalBytes} bytes)${subtitleInfo}`);
}
