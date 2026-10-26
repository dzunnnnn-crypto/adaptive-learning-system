import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createInitialState } from "../../src/domain/lesson-state.js";
import { makeVideoCourse } from "./video-course.js";

const fixtureVideoId = (order) => `vid${String(order).padStart(8, "0")}`;

function vttFor(order) {
  return Buffer.from(
    `WEBVTT\n\n00:00:20.000 --> 00:00:24.000\nТестовая русская субтитровая дорожка главы ${order}.\n`,
    "utf8",
  );
}

function makeCourse({ courseId, order, title, lessonState }) {
  const course = structuredClone(makeVideoCourse());
  const videoId = fixtureVideoId(order);
  const firstVtt = vttFor(1);
  const secondVtt = vttFor(2);
  const readyCount = ["completed", "current", "new"].includes(lessonState) ? 2 : 1;
  const chapterTitles = ["Первый раздел", "Второй раздел"];

  course.id = courseId;
  course.title = title;
  course.source.url = `https://www.youtube.com/watch?v=${videoId}`;
  course.source.title = title;
  course.videoSource.videoId = videoId;
  course.videoSource.canonicalUrl = course.source.url;
  course.videoSource.chapters = chapterTitles.map((chapterTitle, index) => {
    const chapterOrder = index + 1;
    const unitId = `chapter-${String(chapterOrder).padStart(2, "0")}`;
    const assetBytes = chapterOrder === 1 ? firstVtt : secondVtt;
    const base = {
      id: `source-chapter-${String(chapterOrder).padStart(2, "0")}`,
      order: chapterOrder,
      title: chapterTitle,
      startSeconds: index === 0 ? 0 : 353,
      endSeconds: index === 0 ? 353 : 822,
    };
    if (chapterOrder > readyCount) return { ...base, status: "planned" };
    return {
      ...base,
      status: "ready",
      unitId,
      subtitleAsset: {
        fileName: `${unitId}.ru.vtt`,
        mimeType: "text/vtt",
        sizeBytes: assetBytes.length,
        sha256: createHash("sha256").update(assetBytes).digest("hex"),
        language: "ru",
        extractorVersion: "fixture-1",
      },
    };
  });

  course.units = course.videoSource.chapters
    .filter(({ status }) => status === "ready")
    .map((chapter, index) => {
      const unit = structuredClone(makeVideoCourse().units[0]);
      unit.id = chapter.unitId;
      unit.sectionId = "video-chapters";
      unit.order = index + 1;
      unit.title = chapter.title;
      unit.sourceRefs = [chapter.id];
      unit.artifactRefs = [`video-${chapter.id}`];
      unit.checks = unit.checks.map((check, checkIndex) => ({
        ...check,
        id: `${unit.id}-question-${checkIndex + 1}`,
      }));
      unit.transcript.blocks = unit.transcript.blocks.map((block, blockIndex) => ({
        ...block,
        id: `${unit.id}-block-${blockIndex + 1}`,
        startSeconds: chapter.startSeconds + 20,
        endSeconds: chapter.startSeconds + 24,
      }));
      return unit;
    });
  course.coverage = course.videoSource.chapters
    .filter(({ status }) => status === "ready")
    .map((chapter) => ({ id: chapter.id, sourceHeading: chapter.title, unitIds: [chapter.unitId] }));
  course.sourceArtifacts = course.videoSource.chapters
    .filter(({ status }) => status === "ready")
    .map((chapter) => ({
      id: `video-${chapter.id}`,
      kind: "video",
      sourceHeading: chapter.title,
      caption: `Видео главы «${chapter.title}».`,
      coverage: "covered",
      unitIds: [chapter.unitId],
      exclusionReason: null,
      content: {
        type: "youtube",
        videoId,
        startSeconds: chapter.startSeconds,
        endSeconds: chapter.endSeconds,
        accessibilityText: `Тестовый видеофрагмент ${chapter.title}.`,
      },
    }));
  course.source.artifactAudit.artifactCount = course.sourceArtifacts.length;
  return course;
}

function makeState(course, lessonState) {
  const state = createInitialState(course);
  const readyUnitIds = course.units.map(({ id }) => id);
  if (lessonState === "completed") {
    state.cursor = readyUnitIds.length;
    state.lifecycleStatus = "complete";
    state.status = "completed";
    state.completedUnitIds = [...readyUnitIds];
  } else if (lessonState === "current") {
    state.cursor = 1;
    state.lifecycleStatus = "in-progress";
    state.activeUnitIds = ["chapter-02"];
    state.activeQuestionUnitIds = ["chapter-02"];
    state.activeQuestionUnitId = "chapter-02";
    state.status = "awaiting-video-question";
    state.completedUnitIds = ["chapter-01"];
    state.videoProgress = { "chapter-01": { positionSeconds: 60, watched: true, updatedAt: "2026-10-10T10:00:00.000Z" } };
  } else if (lessonState === "partial") {
    state.activeUnitIds = ["chapter-01"];
    state.activeQuestionUnitIds = ["chapter-01"];
    state.activeQuestionUnitId = "chapter-01";
    state.status = "awaiting-video-question";
  } else if (lessonState === "waiting-content") {
    state.cursor = 1;
    state.lifecycleStatus = "waiting-content";
    state.status = "waiting-content";
    state.completedUnitIds = ["chapter-01"];
  }
  return state;
}

export function makePlaylistFixture({ id = "fixture", lessonStates = ["completed", "current", "planned"] } = {}) {
  const allowedStates = new Set(["completed", "current", "partial", "waiting-content", "planned", "unavailable", "new"]);
  if (!Array.isArray(lessonStates) || lessonStates.length === 0 || lessonStates.some((state) => !allowedStates.has(state))) {
    throw new TypeError("lessonStates must contain supported playlist fixture states");
  }

  const lessonSnapshots = new Map();
  const catalogEntries = [];
  const coursesById = new Map();
  const statesById = new Map();
  const items = [];

  lessonStates.forEach((lessonState, index) => {
    const order = index + 1;
    const courseId = `${id}-lesson-${order}`;
    const title = `Урок ${order}`;
    const item = { id: `lesson-${order}`, title, order };
    if (!["planned", "unavailable"].includes(lessonState)) {
      item.courseId = courseId;
      const course = makeCourse({ courseId, order, title, lessonState });
      const state = makeState(course, lessonState);
      const completedIds = new Set(state.completedUnitIds);
      const activeIds = new Set(state.activeUnitIds);
      const chapters = course.videoSource.chapters.map((chapter) => ({
        id: chapter.id,
        unitId: chapter.unitId,
        title: chapter.title,
        order: chapter.order,
        status: chapter.status === "planned"
          ? "planned"
          : completedIds.has(chapter.unitId)
            ? "completed"
            : activeIds.has(chapter.unitId)
              ? "current"
              : "locked",
      }));
      const snapshot = {
        availability: "available",
        courseId,
        title,
        contentVersion: course.contentVersion,
        videoId: course.videoSource.videoId,
        chapters,
        completedUnitIds: [...state.completedUnitIds],
        activeUnitIds: [...state.activeUnitIds],
        cursor: state.cursor,
        status: state.status,
        lifecycleStatus: state.lifecycleStatus,
        updatedAt: state.updatedAt,
        hasLearningActivity: lessonState !== "new",
      };
      lessonSnapshots.set(courseId, snapshot);
      coursesById.set(courseId, course);
      statesById.set(courseId, state);
      catalogEntries.push({
        id: courseId,
        order,
        title,
        summary: `Тестовый пакет ${title}.`,
        archived: lessonState === "completed",
        addedAt: "2026-10-10",
      });
    } else if (lessonState === "unavailable") {
      lessonSnapshots.set(courseId, { availability: "unavailable", courseId, reason: "Fixture course is unavailable" });
    }
    items.push(item);
  });

  const roadmap = {
    id,
    title: "Тестовый плейлист",
    kind: "youtube-playlist",
    author: "Тестовый автор",
    sourceUrl: "https://www.youtube.com/playlist?list=PLabc123",
    addedAt: "2026-10-10",
    sections: [{ id: "lessons", title: "Видеоуроки", order: 1, items }],
  };
  const currentItem = [...items].reverse().find(({ courseId }) => courseId && lessonSnapshots.get(courseId)?.hasLearningActivity);
  return {
    roadmap,
    lessonSnapshots,
    catalogEntries,
    navigation: { lastLessonCourseId: currentItem?.courseId ?? null, lastOpenedAt: currentItem ? "2026-10-10T10:00:00.000Z" : null, archived: false },
    globalLastCourseId: currentItem?.courseId ?? null,
    coursesById,
    statesById,
  };
}

export async function writePlaylistFixture({ root, fixture }) {
  if (!root || !fixture?.coursesById || !fixture?.statesById) throw new TypeError("A root and playlist fixture are required");
  for (const [courseId, course] of fixture.coursesById) {
    const courseDirectory = path.join(root, "courses", courseId);
    const assetsDirectory = path.join(courseDirectory, "assets");
    await fs.mkdir(assetsDirectory, { recursive: true });
    for (const chapter of course.videoSource.chapters) {
      if (chapter.status !== "ready") continue;
      const bytes = vttFor(chapter.order);
      await fs.writeFile(path.join(assetsDirectory, chapter.subtitleAsset.fileName), bytes);
    }
    await fs.writeFile(path.join(courseDirectory, "course.json"), `${JSON.stringify(course, null, 2)}\n`, "utf8");
    const state = fixture.statesById.get(courseId);
    const memory = `# ${course.title}\n\n<!-- adaptive-learning-state:start\n${JSON.stringify(state, null, 2)}\nadaptive-learning-state:end -->\n`;
    await fs.writeFile(path.join(courseDirectory, "learning_memory.md"), memory, "utf8");
  }
}
