import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntime } from "./runtime.js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { app, config } = await buildRuntime({
  projectRoot, dataRoot: process.env.DATA_ROOT,
  enableAi: process.env.ENABLE_AI === "1", env: process.env,
});
const server = app.listen(config.port, config.host, () => {
  console.log(`Adaptive Learning System: http://${config.host}:${config.port}`);
  console.log(process.env.ENABLE_AI === "1" ? "AI explicitly enabled" : "AI disabled; no model credentials loaded");
});
server.on("error", (error) => { console.error(error.code ?? "START_FAILED"); process.exitCode = 1; });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close());
