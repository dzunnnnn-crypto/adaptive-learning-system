import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCourseAssets } from "../src/content/course-assets.js";
import { makeVideoCourse } from "./fixtures/video-course.js";

async function makeVideoAssetFixture({ mode = "valid" } = {}) {
  const courseDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "video-vtt-"));
  const assets = path.join(courseDirectory, "assets");
  await fs.mkdir(assets);
  const course = makeVideoCourse();
  const vtt = Buffer.from("WEBVTT\n\n00:00:28.000 --> 00:00:31.000\nТестовая реплика.\n");
  const payload = mode === "not-vtt" ? Buffer.from("plain text") : vtt;
  const fileName = course.videoSource.chapters[0].subtitleAsset.fileName;
  const filePath = path.join(assets, fileName);
  if (mode !== "missing") await fs.writeFile(filePath, payload);
  course.videoSource.chapters[0].subtitleAsset.sizeBytes =
    mode === "wrong-size" ? payload.length + 1 : payload.length;
  course.videoSource.chapters[0].subtitleAsset.sha256 =
    mode === "wrong-hash"
      ? "f".repeat(64)
      : createHash("sha256").update(payload).digest("hex");
  return { course, courseDirectory, vtt };
}

describe("Video subtitle asset verification", () => {
  it("verifies the ready chapter WebVTT by path, bytes and hash", async () => {
    const { course, courseDirectory, vtt } = await makeVideoAssetFixture();
    const report = await validateCourseAssets({ course, courseDirectory });
    expect(report).toMatchObject({
      checkedSubtitleFiles: 1,
      subtitleBytes: vtt.length,
    });
  });

  it.each([
    ["missing WEBVTT header", "not-vtt"],
    ["hash mismatch", "wrong-hash"],
    ["size mismatch", "wrong-size"],
  ])("rejects %s", async (_label, mode) => {
    const fixture = await makeVideoAssetFixture({ mode });
    await expect(validateCourseAssets(fixture)).rejects.toMatchObject({
      category: "asset-integrity",
    });
  });
});
