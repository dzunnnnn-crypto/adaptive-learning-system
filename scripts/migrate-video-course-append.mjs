import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConfig } from "../src/config.js";
import { CatalogRepository } from "../src/content/catalog-repository.js";
import { CourseSchema } from "../src/domain/course-schema.js";
import { initializeActiveBlock } from "../src/domain/lesson-engine.js";
import { normalizeLearningState } from "../src/domain/lesson-state.js";
import { LearningMemoryStore } from "../src/persistence/learning-memory-store.js";

const COURSE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USAGE = "Usage: node scripts/migrate-video-course-append.mjs <courseId> --candidate <course-vN.json>";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Migration archive path escaped its root");
  }
  return resolvedCandidate;
}

export function buildMigrationArchivePath({ archiveRoot, courseId, contentVersion, now = new Date() }) {
  assertInvariant(COURSE_ID.test(courseId), "Invalid course ID");
  assertInvariant(Number.isInteger(contentVersion) && contentVersion > 0, "Invalid content version");
  return ensureInside(
    archiveRoot,
    path.join(archiveRoot, `${courseId}-content-v${contentVersion}-${timestamp(now)}`),
  );
}

function indexById(values) {
  return new Map(values.map((value) => [value.id, value]));
}

function sourceWithoutAuditCount(source) {
  const result = structuredClone(source);
  if (result.artifactAudit) delete result.artifactAudit.artifactCount;
  return result;
}

function assertAppendOnly(oldCourse, candidate) {
  assertInvariant(oldCourse.schemaVersion === 7 && candidate.schemaVersion === 7, "Video course schemaVersion 7 is required");
  assertInvariant(candidate.id === oldCourse.id, "Candidate course ID does not match");
  assertInvariant(candidate.contentVersion === oldCourse.contentVersion + 1, "Candidate contentVersion must increase by one");
  assertInvariant(deepEqual(oldCourse.sections, candidate.sections), "Existing prepared content changed");
  assertInvariant(deepEqual(sourceWithoutAuditCount(oldCourse.source), sourceWithoutAuditCount(candidate.source)), "Existing prepared content changed");

  const oldChapters = oldCourse.videoSource.chapters;
  const candidateChapters = candidate.videoSource.chapters;
  assertInvariant(candidateChapters.length === oldChapters.length, "Existing prepared content changed");
  const candidateChapterById = indexById(candidateChapters);
  let transition = null;
  for (const oldChapter of oldChapters) {
    const nextChapter = candidateChapterById.get(oldChapter.id);
    assertInvariant(nextChapter, "Existing prepared content changed");
    if (oldChapter.status === "planned" && nextChapter.status === "ready") {
      assertInvariant(!transition, "Exactly one planned chapter must become ready");
      const { status: _oldStatus, ...oldBase } = oldChapter;
      const {
        status: _nextStatus,
        unitId,
        subtitleAsset,
        ...nextBase
      } = nextChapter;
      assertInvariant(deepEqual(oldBase, nextBase) && Boolean(unitId) && Boolean(subtitleAsset), "Existing prepared content changed");
      transition = nextChapter;
    } else {
      assertInvariant(deepEqual(oldChapter, nextChapter), "Existing prepared content changed");
    }
  }
  assertInvariant(transition, "Exactly one planned chapter must become ready");

  const oldUnits = indexById(oldCourse.units);
  const candidateUnits = indexById(candidate.units);
  assertInvariant(candidate.units.length === oldCourse.units.length + 1, "Exactly one new unit is required");
  for (const [id, oldUnit] of oldUnits) {
    assertInvariant(deepEqual(oldUnit, candidateUnits.get(id)), "Existing prepared content changed");
  }
  const appendedUnit = candidateUnits.get(transition.unitId);
  assertInvariant(appendedUnit && !oldUnits.has(appendedUnit.id), "New ready chapter must add its unit");

  for (const key of ["coverage", "sourceArtifacts"]) {
    const oldValues = indexById(oldCourse[key]);
    const candidateValues = indexById(candidate[key]);
    assertInvariant(candidate[key].length === oldCourse[key].length + 1, "Exactly one prepared object must be appended");
    for (const [id, oldValue] of oldValues) {
      assertInvariant(deepEqual(oldValue, candidateValues.get(id)), "Existing prepared content changed");
    }
  }
  const linkedArtifact = candidate.sourceArtifacts.find((artifact) => (
    artifact.unitIds.includes(appendedUnit.id)
    && artifact.content?.type === "youtube"
  ));
  assertInvariant(linkedArtifact, "New ready chapter must add its video artifact");
  return transition;
}

function stateForCandidate(oldState, candidate) {
  let nextState = {
    ...oldState,
    contentVersion: candidate.contentVersion,
  };
  if (oldState.lifecycleStatus === "waiting-content") {
    nextState = initializeActiveBlock(candidate, {
      ...nextState,
      lifecycleStatus: "in-progress",
      status: "awaiting-video-question",
      activeUnitIds: [],
      activeQuestionUnitId: null,
      answer: null,
      layers: [],
      practice: null,
    });
  }
  return normalizeLearningState(nextState, candidate);
}

async function writeArchive({ archivePath, courseBytes, memoryBytes }) {
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  try {
    await fs.mkdir(archivePath);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Migration archive already exists");
    throw error;
  }
  await fs.writeFile(path.join(archivePath, "course.json"), courseBytes, { flag: "wx" });
  await fs.writeFile(path.join(archivePath, "learning_memory.md"), memoryBytes, { flag: "wx" });
  await fs.writeFile(path.join(archivePath, "SHA256SUMS.json"), JSON.stringify({
    course: { fileName: "course.json", sha256: sha256(courseBytes), sizeBytes: courseBytes.length },
    memory: { fileName: "learning_memory.md", sha256: sha256(memoryBytes), sizeBytes: memoryBytes.length },
  }, null, 2) + "\n", { flag: "wx" });
}

async function replaceCourseAtomically(coursePath, bytes) {
  const temporaryPath = path.join(
    path.dirname(coursePath),
    `.${path.basename(coursePath)}.${process.pid}.${Date.now()}.migration.tmp`,
  );
  await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
  try {
    await fs.rename(temporaryPath, coursePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export async function appendVideoCourseMigration({
  courseId,
  courseDirectory,
  memoryPath,
  candidatePath,
  archiveRoot,
  now = () => new Date(),
}) {
  assertInvariant(COURSE_ID.test(courseId), "Invalid course ID");
  const coursePath = path.join(courseDirectory, "course.json");
  const [oldCourseBytes, oldMemoryBytes, candidateBytes] = await Promise.all([
    fs.readFile(coursePath),
    fs.readFile(memoryPath),
    fs.readFile(candidatePath),
  ]);
  const oldCourse = CourseSchema.parse(JSON.parse(oldCourseBytes.toString("utf8")));
  const candidate = CourseSchema.parse(JSON.parse(candidateBytes.toString("utf8")));
  assertInvariant(oldCourse.id === courseId, "Existing course ID does not match");
  const store = new LearningMemoryStore(memoryPath);
  const oldState = normalizeLearningState(await store.load(), oldCourse);
  assertInvariant(oldState.version === 5, "Learning state version five is required");
  const transitionedChapter = assertAppendOnly(oldCourse, candidate);
  const nextState = stateForCandidate(oldState, candidate);
  const archivePath = buildMigrationArchivePath({
    archiveRoot,
    courseId,
    contentVersion: oldCourse.contentVersion,
    now: now(),
  });

  await writeArchive({ archivePath, courseBytes: oldCourseBytes, memoryBytes: oldMemoryBytes });
  let replaced = false;
  try {
    await replaceCourseAtomically(coursePath, candidateBytes);
    replaced = true;
    await store.save(nextState);
    CourseSchema.parse(JSON.parse(await fs.readFile(coursePath, "utf8")));
    normalizeLearningState(await store.load(), candidate);
  } catch (error) {
    if (replaced) {
      await fs.writeFile(coursePath, oldCourseBytes);
      await fs.writeFile(memoryPath, oldMemoryBytes);
    }
    throw error;
  }
  return {
    courseId,
    contentVersion: candidate.contentVersion,
    transitionedChapterId: transitionedChapter.id,
    archivePath,
  };
}

export function parseAppendArguments(args) {
  const [courseId, flag, candidatePath, ...extra] = args;
  if (!COURSE_ID.test(courseId ?? "") || flag !== "--candidate" || !candidatePath || extra.length > 0) {
    throw new Error(USAGE);
  }
  return { courseId, candidatePath };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const { courseId, candidatePath } = parseAppendArguments(process.argv.slice(2));
    const config = createConfig();
    const repository = new CatalogRepository(config);
    await repository.list();
    const courseDirectory = path.dirname(repository.coursePath(courseId));
    const result = await appendVideoCourseMigration({
      courseId,
      courseDirectory,
      memoryPath: repository.memoryPath(courseId),
      candidatePath,
      archiveRoot: path.join(config.projectRoot, "_archive"),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
