import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { CourseSchema } from "../src/domain/course-schema.js";
import { buildRuntime, prepareRuntime } from "../src/runtime.js";
import { makeVideoCourse } from "./fixtures/video-course.js";

const projectRoot = process.cwd();
const paths = [];
async function runtime() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "learning-example-"));
  paths.push(dataRoot);
  return { ...(await buildRuntime({ projectRoot, dataRoot, env: { ZAI_API_KEY: "test-key-must-not-be-used" } })), dataRoot };
}
afterEach(async () => { for (const p of paths.splice(0)) await fs.rm(p, { recursive: true, force: true }); });

describe("redistributable video example", () => {
  it("rejects a runtime that would write progress into the example sources", async () => {
    await expect(prepareRuntime({ projectRoot, dataRoot: projectRoot })).rejects.toThrow("DATA_ROOT");
    await expect(prepareRuntime({ projectRoot, dataRoot: path.join(projectRoot, "courses", "runtime") })).rejects.toThrow("DATA_ROOT");
  });
  it("does not silently reset a missing memory from an existing runtime", async () => {
    const r = await runtime();
    await fs.unlink(path.join(r.dataRoot, "courses", "chatgpt-images-practice", "learning_memory.md"));
    await expect(buildRuntime({ projectRoot, dataRoot: r.dataRoot })).rejects.toThrow("Learning memory is missing");
  });
  it("requires explicit embed-only mode and preserves legacy subtitle validation", () => {
    const legacy = makeVideoCourse();
    delete legacy.videoSource.chapters[0].subtitleAsset;
    expect(CourseSchema.safeParse(legacy).success).toBe(false);
    legacy.videoSource.materialMode = "embedded-only";
    delete legacy.units[0].transcript;
    expect(CourseSchema.safeParse(legacy).success).toBe(true);
    legacy.units[0].transcript = makeVideoCourse().units[0].transcript;
    expect(CourseSchema.safeParse(legacy).success).toBe(false);
  });
  it("loads the complete example without copied subtitles, transcripts or personal memory", async () => {
    const course = CourseSchema.parse(JSON.parse(await fs.readFile("courses/chatgpt-images-practice/course.json", "utf8")));
    expect(course.units).toHaveLength(14);
    expect(course.units.flatMap((u) => u.checks)).toHaveLength(42);
    expect(course.units.some((u) => u.transcript)).toBe(false);
    expect(course.videoSource.chapters.some((c) => c.subtitleAsset)).toBe(false);
    const correct = course.units.flatMap((u) => u.checks.map((q) => q.correct));
    for (const letter of ["А", "Б", "В"]) expect(correct.filter((v) => v === letter)).toHaveLength(14);
    expect(course.videoSource.chapters.at(-1).endSeconds).toBe(912);
  });
  it("disables AI even when credentials exist in the caller environment", async () => {
    const r = await runtime();
    const profiles = await request(r.app).get("/api/ai/profiles");
    expect(profiles.body).toEqual({ selectedProfileId: null, profiles: [], mode: "disabled" });
    const selection = await request(r.app).put("/api/ai/profile").send({ profileId: "codex-luna-high" });
    expect(selection.status).toBe(503);
    expect(selection.body.code).toBe("AI_DISABLED");
    expect(r.config.zaiApiKey).toBeNull();
  });
  it("rejects foreign origins and DNS-rebinding hosts before changing state", async () => {
    const r = await runtime();
    expect((await request(r.app).get("/api/courses").set("Host", "attacker.invalid")).status).toBe(403);
    expect((await request(r.app).post("/api/courses/chatgpt-images-practice/next").set("Origin", "https://attacker.invalid").send({})).status).toBe(403);
    expect((await request(r.app).get("/.env.local")).status).toBe(404);
    expect((await request(r.app).get("/.local/runtime/app-state.json")).status).toBe(404);
  });
  it("resumes a checked answer and video position after rebuilding the runtime", async () => {
    const r = await runtime();
    const service = await r.manager.serviceFor("chatgpt-images-practice");
    const before = await service.getView();
    const reviewed = await service.answerVideoQuestion(before.question.id, "Б");
    await service.updateVideoProgress("chapter-01", 20);
    const reopened = await buildRuntime({ projectRoot, dataRoot: r.dataRoot });
    const resumed = await (await reopened.manager.serviceFor("chatgpt-images-practice")).getView();
    expect(resumed.status).toBe("video-question-reviewed");
    expect(resumed.questionReview.choice).toBe("Б");
    expect(resumed.questionReview.correct).toBe(reviewed.questionReview.correct);
    expect(resumed.videoProgress.positionSeconds).toBe(20);
    expect(resumed.completedUnitIds).toHaveLength(0);
    await expect(fs.access("courses/chatgpt-images-practice/learning_memory.md")).rejects.toThrow();
  });
});
