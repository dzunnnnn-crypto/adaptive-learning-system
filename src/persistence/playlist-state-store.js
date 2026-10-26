import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const IdentifierSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const TimestampSchema = z.string().datetime({ offset: true });

const PlaylistNavigationSchema = z.object({
  lastLessonCourseId: IdentifierSchema.nullable(),
  lastOpenedAt: TimestampSchema.nullable(),
  archived: z.boolean(),
}).strict();

const PlaylistStateSchema = z.object({
  schemaVersion: z.literal(1),
  playlists: z.record(IdentifierSchema, PlaylistNavigationSchema),
}).strict();

const SelectSchema = z.object({
  playlistId: IdentifierSchema,
  lessonCourseId: IdentifierSchema,
  openedAt: TimestampSchema,
}).strict();

function navigationError(cause) {
  return Object.assign(new Error("Playlist navigation is unavailable", { cause }), {
    category: "playlist-navigation-unavailable",
  });
}

export class PlaylistStateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.tail = Promise.resolve();
  }

  async load() {
    try {
      return PlaylistStateSchema.parse(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return { schemaVersion: 1, playlists: {} };
      throw navigationError(error);
    }
  }

  enqueue(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => {});
    return result;
  }

  async write(state) {
    const parsed = PlaylistStateSchema.parse(state);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  async get(playlistId) {
    const id = IdentifierSchema.parse(playlistId);
    const state = await this.load();
    const navigation = state.playlists[id];
    return navigation ? { ...navigation } : null;
  }

  select(playlistId, lessonCourseId, { openedAt }) {
    const input = SelectSchema.parse({ playlistId, lessonCourseId, openedAt });
    return this.enqueue(async () => {
      const state = await this.load();
      const navigation = {
        lastLessonCourseId: input.lessonCourseId,
        lastOpenedAt: input.openedAt,
        archived: state.playlists[input.playlistId]?.archived ?? false,
      };
      state.playlists[input.playlistId] = navigation;
      await this.write(state);
      return { ...navigation };
    });
  }

  setArchived(playlistId, archived) {
    const id = IdentifierSchema.parse(playlistId);
    const isArchived = z.boolean().parse(archived);
    return this.enqueue(async () => {
      const state = await this.load();
      const navigation = {
        lastLessonCourseId: state.playlists[id]?.lastLessonCourseId ?? null,
        lastOpenedAt: state.playlists[id]?.lastOpenedAt ?? null,
        archived: isArchived,
      };
      state.playlists[id] = navigation;
      await this.write(state);
      return { ...navigation };
    });
  }
}
