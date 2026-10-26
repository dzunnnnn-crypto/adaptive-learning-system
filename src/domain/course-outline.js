import { API_VERSION, APP_ID } from "../app-identity.js";

function statusFor(unitId, completedIds, currentIds) {
  if (completedIds.has(unitId) && currentIds.has(unitId)) {
    throw new Error("Outline state contains overlapping units");
  }
  if (completedIds.has(unitId)) return "completed";
  if (currentIds.has(unitId)) return "current";
  return "locked";
}

function roadmapStatus(item, summaries, currentCourseId) {
  if (!item.courseId) return "planned";
  const summary = summaries.get(item.courseId);
  if (!summary || summary.lifecycleStatus === "unavailable") return "unavailable";
  if (summary.lifecycleStatus === "complete") return "completed";
  if (item.courseId === currentCourseId) return "current";
  return "available";
}

export function buildCourseRoadmapOutline(roadmap, summaries, currentCourseId) {
  const sections = roadmap.sections.map((section) => {
    const items = section.items.map((item) => ({
      id: item.id,
      title: item.title,
      order: item.order,
      status: roadmapStatus(item, summaries, currentCourseId),
      ...(item.courseId ? { courseId: item.courseId } : {}),
    }));
    return {
      id: section.id,
      title: section.title,
      order: section.order,
      containsCurrent: items.some((item) => item.status === "current"),
      items,
    };
  });
  const items = sections.flatMap((section) => section.items);
  return {
    id: roadmap.id,
    title: roadmap.title,
    progress: {
      completed: items.filter((item) => item.status === "completed").length,
      prepared: items.filter((item) => item.status !== "planned").length,
      total: items.length,
    },
    sections,
  };
}


function chapterToSectionUnit(chapter, completedIds, currentIds) {
  if (chapter.status === "ready") {
    return {
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      status: statusFor(chapter.unitId, completedIds, currentIds),
    };
  }
  return {
    id: chapter.id,
    title: chapter.title,
    order: chapter.order,
    status: "planned",
  };
}

function buildVideoCourseOutline(course, state) {
  const completedIds = new Set(state.completedUnitIds);
  const currentIds = new Set(state.activeUnitIds);
  const chapters = course.videoSource.chapters;
  const readyChapters = chapters.filter((chapter) => chapter.status === "ready");

  function chapterSectionId(chapter) {
    if (chapter.status === "ready") {
      const unit = course.units.find((u) => u.id === chapter.unitId);
      return unit?.sectionId ?? course.sections[0]?.id;
    }
    return course.sections[0]?.id;
  }

  const sections = course.sections.map((section) => {
    const sectionChapters = chapters.filter((chapter) => chapterSectionId(chapter) === section.id);
    const sectionReadyUnits = course.units.filter((unit) => unit.sectionId === section.id);
    return {
      id: section.id,
      title: section.title,
      order: section.order,
      progress: {
        completed: sectionReadyUnits.filter((unit) => completedIds.has(unit.id)).length,
        total: sectionReadyUnits.length,
      },
      containsCurrent: sectionReadyUnits.some((unit) => currentIds.has(unit.id)),
      units: sectionChapters.map((chapter) => chapterToSectionUnit(chapter, completedIds, currentIds)),
    };
  });

  return {
    appId: APP_ID,
    apiVersion: API_VERSION,
    courseId: course.id,
    title: course.title,
    progress: {
      completed: completedIds.size,
      total: course.units.length,
    },
    prepared: {
      completed: completedIds.size,
      total: readyChapters.length,
    },
    chapterPreparation: {
      ready: readyChapters.length,
      total: chapters.length,
    },
    sections,
  };
}

export function buildCourseOutline(course, state) {
  if (course.schemaVersion === 7) {
    return buildVideoCourseOutline(course, state);
  }
  const completedIds = new Set(state.completedUnitIds);
  const currentIds = new Set(state.activeUnitIds);
  const sections = course.sections.map((section) => {
    const units = course.units.filter((unit) => unit.sectionId === section.id);
    return {
      id: section.id,
      title: section.title,
      order: section.order,
      progress: {
        completed: units.filter((unit) => completedIds.has(unit.id)).length,
        total: units.length,
      },
      containsCurrent: units.some((unit) => currentIds.has(unit.id)),
      units: units.map((unit) => ({
        id: unit.id,
        title: unit.title,
        order: unit.order,
        status: statusFor(unit.id, completedIds, currentIds),
      })),
    };
  });

  return {
    appId: APP_ID,
    apiVersion: API_VERSION,
    courseId: course.id,
    title: course.title,
    progress: {
      completed: completedIds.size,
      total: course.units.length,
    },
    sections,
  };
}
