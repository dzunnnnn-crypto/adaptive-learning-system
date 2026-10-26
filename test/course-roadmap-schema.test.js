import { describe, expect, it } from "vitest";
import { CourseRoadmapsSchema } from "../src/domain/course-roadmap-schema.js";

function makeRoadmaps() {
  return {
    schemaVersion: 1,
    roadmaps: [{
      id: "agent-workflow",
      title: "Агенты",
      sections: [{
        id: "module-one",
        title: "Модуль 1",
        order: 1,
        items: [
          { id: "introduction", title: "Введение", order: 1, courseId: "intro-course" },
          { id: "chapter-one", title: "Глава 1", order: 2 },
        ],
      }],
    }],
  };
}

describe("course roadmap schema", () => {
  it("accepts planned items without a course package", () => {
    const parsed = CourseRoadmapsSchema.parse(makeRoadmaps());
    expect(parsed.roadmaps[0].sections[0].items[1]).not.toHaveProperty("courseId");
  });

  it("rejects a repeated published course link", () => {
    const document = makeRoadmaps();
    document.roadmaps[0].sections[0].items.push({
      id: "chapter-two",
      title: "Глава 2",
      order: 3,
      courseId: "intro-course",
    });
    expect(() => CourseRoadmapsSchema.parse(document))
      .toThrow("A course can be linked to only one roadmap item");
  });

  it("requires sequential sections and items", () => {
    const document = makeRoadmaps();
    document.roadmaps[0].sections[0].items[1].order = 3;
    expect(() => CourseRoadmapsSchema.parse(document))
      .toThrow("Roadmap items must be sequential within a section");
  });

  it("accepts complete YouTube playlist metadata and preserves legacy roadmaps", () => {
    const legacyDocument = makeRoadmaps();
    const parsedLegacy = CourseRoadmapsSchema.parse(legacyDocument);
    expect(parsedLegacy).toEqual(legacyDocument);

    const playlist = {
      schemaVersion: 1,
      roadmaps: [{
        id: "playlist",
        title: "Плейлист",
        kind: "youtube-playlist",
        author: "Автор",
        sourceUrl: "https://www.youtube.com/playlist?list=PLabc123",
        addedAt: "2026-10-10",
        sections: [{
          id: "lessons",
          title: "Видеоуроки",
          order: 1,
          items: [{ id: "lesson-one", title: "Урок 1", order: 1 }],
        }],
      }],
    };
    expect(CourseRoadmapsSchema.parse(playlist).roadmaps[0]).toMatchObject({
      kind: "youtube-playlist",
      author: "Автор",
      sourceUrl: "https://www.youtube.com/playlist?list=PLabc123",
      addedAt: "2026-10-10",
    });
  });

  it("requires complete secure playlist metadata and unique linked courses", () => {
    const playlist = {
      schemaVersion: 1,
      roadmaps: [{
        id: "playlist",
        title: "Плейлист",
        kind: "youtube-playlist",
        author: "Автор",
        sourceUrl: "http://www.youtube.com/playlist?list=PLabc123",
        addedAt: "2026-10-10",
        sections: [{
          id: "lessons",
          title: "Видеоуроки",
          order: 1,
          items: [
            { id: "lesson-one", title: "Урок 1", order: 1, courseId: "same-course" },
            { id: "lesson-two", title: "Урок 2", order: 2, courseId: "same-course" },
          ],
        }],
      }],
    };
    expect(() => CourseRoadmapsSchema.parse(playlist)).toThrow();

    const incomplete = structuredClone(playlist);
    delete incomplete.roadmaps[0].author;
    expect(() => CourseRoadmapsSchema.parse(incomplete)).toThrow();
  });

  it("rejects hidden content fields on planned playlist items", () => {
    const document = {
      schemaVersion: 1,
      roadmaps: [{
        id: "playlist",
        title: "Плейлист",
        kind: "youtube-playlist",
        author: "Автор",
        sourceUrl: "https://www.youtube.com/playlist?list=PLabc123",
        addedAt: "2026-10-10",
        sections: [{
          id: "lessons",
          title: "Видеоуроки",
          order: 1,
          items: [{ id: "lesson-one", title: "Урок 1", order: 1, transcript: "секретный текст" }],
        }],
      }],
    };
    expect(() => CourseRoadmapsSchema.parse(document)).toThrow();
  });
});
