import { z } from "zod";

export const CatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  order: z.number().int().positive(),
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(300),
  archived: z.boolean().default(false),
  addedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
}).strict();

export const CatalogSchema = z.object({
  schemaVersion: z.literal(1),
  courses: z.array(CatalogEntrySchema).min(1),
}).strict().superRefine((catalog, context) => {
  const ids = new Set();
  catalog.courses.forEach((course, index) => {
    if (ids.has(course.id)) {
      context.addIssue({
        code: "custom",
        path: ["courses", index, "id"],
        message: "Duplicate course id",
      });
    }
    ids.add(course.id);
    if (course.order !== index + 1) {
      context.addIssue({
        code: "custom",
        path: ["courses", index, "order"],
        message: "Courses must be sequential",
      });
    }
  });
});

export function serializeCatalog(courses) {
  return { schemaVersion: 1, courses };
}
