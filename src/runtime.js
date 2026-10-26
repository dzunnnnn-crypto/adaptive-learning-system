import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import express from "express";
import { createConfig } from "./config.js";
import { CatalogRepository } from "./content/catalog-repository.js";
import { CourseRoadmapRepository } from "./content/course-roadmap-repository.js";
import { loadCourse } from "./content/course-repository.js";
import { AppStateStore } from "./persistence/app-state-store.js";
import { PlaylistStateStore } from "./persistence/playlist-state-store.js";
import { CourseSessionManager } from "./application/course-session-manager.js";
import { buildPrompt } from "./ai/prompt-builder.js";
import { createApp } from "./http/create-app.js";
import { seedNewCourseState } from "../scripts/seed-current-state.js";

const aiDisabled = () => Object.assign(new Error("AI is disabled for this local example"), { category: "ai-disabled" });

async function copyOnce(from, to, verify = false) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try { await fs.copyFile(from, to, constants.COPYFILE_EXCL); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (verify && !(await fs.readFile(from)).equals(await fs.readFile(to))) {
      throw new Error("Example content changed: use a separate DATA_ROOT or migrate existing progress");
    }
  }
}

export async function prepareRuntime({ projectRoot, dataRoot = path.join(projectRoot, ".local", "runtime") }) {
  const root = path.resolve(projectRoot);
  const runtime = path.resolve(dataRoot);
  const sourceCourses = path.join(root, "courses");
  const runtimeCourses = path.join(runtime, "courses");
  if (runtimeCourses === sourceCourses) throw new Error("DATA_ROOT must be outside the source courses directory");
  const relative = path.relative(sourceCourses, runtime);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("DATA_ROOT must be outside the source courses directory");
  }
  for (const file of ["catalog.json", "roadmaps.json"]) {
    await copyOnce(path.join(root, "courses", file), path.join(runtime, "courses", file));
  }
  const sourceCatalog = new CatalogRepository({ coursesRoot: path.join(root, "courses"), catalogPath: path.join(root, "courses", "catalog.json") });
  const catalogRepository = new CatalogRepository({ coursesRoot: path.join(runtime, "courses"), catalogPath: path.join(runtime, "courses", "catalog.json") });
  const marker = path.join(runtime, "initialized.json");
  let initialized = false;
  try { await fs.access(marker); initialized = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const entry of await sourceCatalog.list()) {
    await copyOnce(sourceCatalog.coursePath(entry.id), path.join(runtime, "courses", entry.id, "course.json"), true);
    await loadCourse(path.join(runtime, "courses", entry.id, "course.json"));
    await catalogRepository.load();
    try { await fs.access(catalogRepository.memoryPath(entry.id)); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (initialized) throw new Error("Learning memory is missing; restore its backup or choose a fresh DATA_ROOT");
      await seedNewCourseState({ courseId: entry.id, catalogRepository });
    }
  }
  if (!initialized) await fs.writeFile(marker, JSON.stringify({ version: 1 }) + "\n", { flag: "wx" });
  return { root, runtime, catalogRepository };
}

export async function buildRuntime({ projectRoot, dataRoot, enableAi = false, env = {} }) {
  const { root, runtime, catalogRepository } = await prepareRuntime({ projectRoot, dataRoot });
  const config = createConfig({
    PROJECT_ROOT: root, PORT: env.PORT ?? "8809",
    COURSES_ROOT: path.join(runtime, "courses"),
    CATALOG_PATH: path.join(runtime, "courses", "catalog.json"),
    ROADMAPS_PATH: path.join(runtime, "courses", "roadmaps.json"),
    APP_STATE_PATH: path.join(runtime, "app-state.json"),
    PLAYLIST_STATE_PATH: path.join(runtime, "playlist-state.json"),
    ZAI_API_KEY: enableAi ? env.ZAI_API_KEY : "",
  });
  const appStateStore = new AppStateStore(config.appStatePath);
  let aiProfileService = {
    getPublicState: async () => ({ selectedProfileId: null, profiles: [], mode: "disabled" }),
    select: async () => { throw aiDisabled(); },
  };
  let provider = { generate: async () => { throw aiDisabled(); } };
  if (enableAi) {
    const [{ AiProfileService }, { createProviderRouter }, { createCodexProvider }, { createZaiProvider }] = await Promise.all([
      import("./application/ai-profile-service.js"), import("./ai/provider-router.js"),
      import("./ai/codex-provider.js"), import("./ai/zai-provider.js"),
    ]);
    aiProfileService = new AiProfileService({ appStateStore, zaiApiKey: config.zaiApiKey });
    provider = createProviderRouter({ profileService: aiProfileService, providerFactories: {
      codex: (profile) => createCodexProvider({ workingDirectory: root, model: profile.model, modelReasoningEffort: profile.modelReasoningEffort, timeoutMs: profile.timeoutMs }),
      zai: (profile) => createZaiProvider({ apiKey: config.zaiApiKey, model: profile.model, reasoningEffort: profile.reasoningEffort, thinkingEnabled: profile.thinkingEnabled, timeoutMs: profile.timeoutMs }),
    } });
  }
  const manager = new CourseSessionManager({
    catalogRepository, appStateStore, providerFactory: () => provider, promptBuilder: buildPrompt,
    projectRoot: root,
    roadmapRepository: new CourseRoadmapRepository({ roadmapsPath: config.roadmapsPath }),
    playlistStateStore: new PlaylistStateStore(config.playlistStatePath),
  });
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.set("X-Content-Type-Options", "nosniff");
    response.set("Referrer-Policy", "strict-origin-when-cross-origin");
    const host = request.headers.host ?? "";
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(host)) return response.sendStatus(403);
    if (request.method !== "GET" && request.method !== "HEAD") {
      if ((request.headers.origin && request.headers.origin !== `http://${host}`)
        || request.headers["sec-fetch-site"] === "cross-site") return response.sendStatus(403);
    }
    if (request.path.startsWith("/api/")) response.set("Cache-Control", "no-store");
    next();
  });
  app.use(createApp({ manager, publicPath: config.publicPath, aiProfileService }));
  return { app, manager, config, runtime };
}
