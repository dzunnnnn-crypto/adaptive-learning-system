import { z } from "zod";

const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const RoadmapItemSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(3).max(160),
  order: z.number().int().positive(),
  courseId: IdentifierSchema.optional(),
}).strict();

const RoadmapSectionSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(3).max(160),
  order: z.number().int().positive(),
  items: z.array(RoadmapItemSchema).min(1),
}).strict();

const RoadmapSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(3).max(160),
  kind: z.literal("youtube-playlist").optional(),
  author: z.string().trim().min(1).max(160).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  addedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sections: z.array(RoadmapSectionSchema).min(1),
}).strict().superRefine((roadmap, context) => {
  const playlistFields = [roadmap.author, roadmap.sourceUrl, roadmap.addedAt];
  if (roadmap.kind === "youtube-playlist") {
    if (playlistFields.some((value) => value === undefined)) {
      context.addIssue({ code: "custom", message: "YouTube playlists require author, sourceUrl and addedAt" });
    }
    if (roadmap.sourceUrl) {
      let protocol;
      try {
        protocol = new URL(roadmap.sourceUrl).protocol;
      } catch {
        protocol = null;
      }
      if (protocol !== "https:") {
        context.addIssue({ code: "custom", path: ["sourceUrl"], message: "Playlist sourceUrl must use HTTPS" });
      }
    }
  } else if (playlistFields.some((value) => value !== undefined)) {
    context.addIssue({ code: "custom", message: "Playlist metadata requires kind youtube-playlist" });
  }
});

export const CourseRoadmapsSchema = z.object({
  schemaVersion: z.literal(1),
  roadmaps: z.array(RoadmapSchema),
}).strict().superRefine((document, context) => {
  const roadmapIds = new Set();
  const mappedCourseIds = new Set();

  document.roadmaps.forEach((roadmap, roadmapIndex) => {
    if (roadmapIds.has(roadmap.id)) {
      context.addIssue({ code: "custom", path: ["roadmaps", roadmapIndex, "id"], message: "Duplicate roadmap id" });
    }
    roadmapIds.add(roadmap.id);
    const sectionIds = new Set();
    const itemIds = new Set();
    roadmap.sections.forEach((section, sectionIndex) => {
      if (section.order !== sectionIndex + 1) {
        context.addIssue({ code: "custom", path: ["roadmaps", roadmapIndex, "sections", sectionIndex, "order"], message: "Roadmap sections must be sequential" });
      }
      if (sectionIds.has(section.id)) {
        context.addIssue({ code: "custom", path: ["roadmaps", roadmapIndex, "sections", sectionIndex, "id"], message: "Duplicate roadmap section id" });
      }
      sectionIds.add(section.id);
      section.items.forEach((item, itemIndex) => {
        if (item.order !== itemIndex + 1) {
          context.addIssue({ code: "custom", path: ["roadmaps", roadmapIndex, "sections", sectionIndex, "items", itemIndex, "order"], message: "Roadmap items must be sequential within a section" });
        }
        if (itemIds.has(item.id)) {
          context.addIssue({ code: "custom", path: ["roadmaps", roadmapIndex, "sections", sectionIndex, "items", itemIndex, "id"], message: "Duplicate roadmap item id" });
        }
        itemIds.add(item.id);
        if (item.courseId) {
          if (mappedCourseIds.has(item.courseId)) {
            context.addIssue({ code: "custom", path: ["roadmaps", roadmapIndex, "sections", sectionIndex, "items", itemIndex, "courseId"], message: "A course can be linked to only one roadmap item" });
          }
          mappedCourseIds.add(item.courseId);
        }
      });
    });
  });
});
