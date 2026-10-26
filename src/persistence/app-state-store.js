import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_AI_PROFILE_ID,
  isKnownAiProfileId,
} from "../ai/ai-profile-registry.js";

const CourseIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const PersistedAppStateSchema = z.object({
  lastCourseId: CourseIdSchema.nullable(),
  aiProfileId: z.string().optional(),
}).strict();

const AppStateSchema = z.object({
  lastCourseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  aiProfileId: z.string(),
}).strict();

const AppStatePatchSchema = z.object({
  lastCourseId: CourseIdSchema.nullable().optional(),
  aiProfileId: z.string().optional(),
}).strict();

function normalizeState(state) {
  const parsed = PersistedAppStateSchema.parse(state);
  return AppStateSchema.parse({
    lastCourseId: parsed.lastCourseId,
    aiProfileId: isKnownAiProfileId(parsed.aiProfileId)
      ? parsed.aiProfileId
      : DEFAULT_AI_PROFILE_ID,
  });
}

export class AppStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tail = Promise.resolve();
  }

  async load() {
    try {
      return normalizeState(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { lastCourseId: null, aiProfileId: DEFAULT_AI_PROFILE_ID };
      }
      throw error;
    }
  }

  enqueue(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => {});
    return result;
  }

  async write(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  save(state) {
    const parsed = normalizeState(state);
    return this.enqueue(async () => {
      await this.write(parsed);
    });
  }

  update(patch) {
    const parsedPatch = AppStatePatchSchema.parse(patch);
    return this.enqueue(async () => {
      const next = normalizeState({ ...(await this.load()), ...parsedPatch });
      await this.write(next);
      return next;
    });
  }
}
