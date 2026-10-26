import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConfig } from "../src/config.js";
import { CatalogRepository } from "../src/content/catalog-repository.js";
import { loadCourse } from "../src/content/course-repository.js";
import { initializeActiveBlock } from "../src/domain/lesson-engine.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";

const USAGE = "Usage: node scripts/seed-current-state.js <courseId> --new [--target-size <positive-integer>]";

export function parseSeedArguments(args) {
  const [courseId, mode, targetFlag, targetValue, ...extra] = args;
  const defaultSyntax = Boolean(courseId)
    && mode === "--new"
    && targetFlag === undefined
    && targetValue === undefined
    && extra.length === 0;
  const targetSyntax = Boolean(courseId)
    && mode === "--new"
    && targetFlag === "--target-size"
    && targetValue !== undefined
    && extra.length === 0;

  if (!defaultSyntax && !targetSyntax) throw new Error(USAGE);

  const targetSize = targetSyntax ? Number(targetValue) : 1;
  if (!Number.isInteger(targetSize) || targetSize < 1) throw new Error(USAGE);
  return { courseId, targetSize };
}

export async function seedNewCourseState({ courseId, catalogRepository, targetSize = 1 }) {
  const entry = await catalogRepository.get(courseId);
  const course = await loadCourse(catalogRepository.coursePath(courseId));
  const memoryPath = catalogRepository.memoryPath(courseId);
  const state = initializeActiveBlock(
    course,
    createInitialState(course, { targetSize }),
  );
  const store = new LearningMemoryStore(memoryPath);
  await store.create(state, {
    humanText: `# Learning Memory: ${entry.title}\n\n## Текущая точка\n\nКурс подготовлен, обучение ещё не начато.`,
  });
  return { memoryPath, state };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  let args;
  try {
    args = parseSeedArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (args) {
    const config = createConfig();
    const catalogRepository = new CatalogRepository(config);
    const result = await seedNewCourseState({ ...args, catalogRepository });
    console.log(`Created new course memory: ${result.memoryPath}`);
  }
}
