import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntime } from "../src/runtime.js";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "learning-http-smoke-"));
const courseId = "chatgpt-images-practice";
const source = await fs.readFile(path.join(projectRoot, "courses", courseId, "course.json"), "utf8");
const course = JSON.parse(source);
let server;
try {
  const { app } = await buildRuntime({ projectRoot, dataRoot });
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(route, method = "GET", body) {
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200, `${method} ${route}: ${response.status}`);
    return response.json();
  }
  assert.equal((await api("/api/courses")).courses.length, 1);
  assert.equal((await api("/api/ai/profiles")).mode, "disabled");
  let view = await api(`/api/courses/${courseId}/session`);
  let answered = 0;
  for (const unit of course.units) {
    for (const check of unit.checks) {
      assert.equal(view.question.id, check.id);
      view = await api(`/api/courses/${courseId}/questions/${check.id}/answer`, "POST", { choice: check.correct });
      assert.equal(view.questionReview.correct, true);
      view = await api(`/api/courses/${courseId}/next`, "POST", {});
      answered++;
    }
  }
  assert.equal(answered, 42);
  assert.equal(view.status, "complete");
  assert.equal(view.completedUnitIds.length, 14);
  const resumed = await buildRuntime({ projectRoot, dataRoot });
  assert.equal((await (await resumed.manager.serviceFor(courseId)).getView()).status, "complete");
  assert.equal(await fs.readFile(path.join(projectRoot, "courses", courseId, "course.json"), "utf8"), source);
  console.log("HTTP smoke passed: 14 chapters / 42 answers / completion / restart / immutable example / AI disabled");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataRoot, { recursive: true, force: true });
}
