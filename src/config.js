import path from "node:path";

export function createConfig(env = process.env) {
  const port = Number(env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const projectRoot = path.resolve(env.PROJECT_ROOT ?? process.cwd());
  return {
    host: "127.0.0.1",
    port,
    projectRoot,
    coursesRoot: path.resolve(projectRoot, env.COURSES_ROOT ?? "courses"),
    catalogPath: path.resolve(
      projectRoot,
      env.CATALOG_PATH ?? path.join("courses", "catalog.json"),
    ),
    roadmapsPath: path.resolve(
      projectRoot,
      env.ROADMAPS_PATH ?? path.join("courses", "roadmaps.json"),
    ),
    appStatePath: path.resolve(
      projectRoot,
      env.APP_STATE_PATH ?? path.join("data", "app-state.json"),
    ),
    playlistStatePath: path.resolve(
      projectRoot,
      env.PLAYLIST_STATE_PATH ?? path.join("data", "playlist-state.json"),
    ),
    publicPath: path.join(projectRoot, "public"),
    zaiApiKey: String(env.ZAI_API_KEY ?? "").trim() || null,
  };
}
