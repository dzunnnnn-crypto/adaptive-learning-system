import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openCourseAsset, readCourseAsset, validateCourseAssets } from "../src/content/course-assets.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";

const directories = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const webm = Buffer.from("1a45dfa39f42868101", "hex");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function makeHarness({ buffer = png, writeFile = true } = {}) {
  const courseDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "course-assets-"));
  directories.push(courseDirectory);
  const assetsDirectory = path.join(courseDirectory, "assets");
  await fs.mkdir(assetsDirectory);
  const course = makeUniversalCourse({ withRenderableArtifacts: true });
  course.sourceArtifacts[0].content.sha256 = sha256(buffer);
  if (writeFile) {
    await fs.writeFile(path.join(assetsDirectory, "foundation-map.png"), buffer);
  }
  return { course, courseDirectory };
}

async function makeFileHarness() {
  const courseDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "course-file-assets-"));
  directories.push(courseDirectory);
  const assetsDirectory = path.join(courseDirectory, "assets");
  await fs.mkdir(assetsDirectory);
  const course = makeUniversalCourse({ withFileArtifacts: true });
  const artifact = course.sourceArtifacts[1];
  artifact.content.sizeBytes = webm.length;
  artifact.content.sha256 = sha256(webm);
  await fs.writeFile(path.join(assetsDirectory, artifact.content.fileName), webm);
  return { course, courseDirectory, artifact };
}

describe("course image assets", () => {
  it("reads one declared PNG with its verified MIME and hash", async () => {
    const { course, courseDirectory } = await makeHarness();

    const asset = await readCourseAsset({
      course,
      courseDirectory,
      fileName: "foundation-map.png",
    });

    expect(asset.buffer).toEqual(png);
    expect(asset.contentType).toBe("image/png");
    expect(asset.sha256).toBe(sha256(png));
  });

  it("rejects an undeclared image without touching another file", async () => {
    const { course, courseDirectory } = await makeHarness();
    await fs.writeFile(path.join(courseDirectory, "assets", "private.png"), png);

    await expect(readCourseAsset({ course, courseDirectory, fileName: "private.png" }))
      .rejects.toMatchObject({ category: "asset-not-found" });
  });

  it("rejects path traversal before reading the filesystem", async () => {
    const { course, courseDirectory } = await makeHarness();

    await expect(readCourseAsset({
      course,
      courseDirectory,
      fileName: "../learning_memory.md",
    })).rejects.toMatchObject({ category: "invalid-asset-request" });
  });

  it("reports a declared but missing image", async () => {
    const { course, courseDirectory } = await makeHarness({ writeFile: false });

    await expect(readCourseAsset({
      course,
      courseDirectory,
      fileName: "foundation-map.png",
    })).rejects.toMatchObject({ category: "asset-not-found" });
  });

  it("rejects an image whose hash changed", async () => {
    const { course, courseDirectory } = await makeHarness();
    course.sourceArtifacts[0].content.sha256 = "f".repeat(64);

    await expect(readCourseAsset({
      course,
      courseDirectory,
      fileName: "foundation-map.png",
    })).rejects.toMatchObject({ category: "asset-integrity" });
  });

  it("rejects non-PNG bytes hidden behind a PNG extension", async () => {
    const disguised = Buffer.from("not an image", "utf8");
    const { course, courseDirectory } = await makeHarness({ buffer: disguised });

    await expect(readCourseAsset({
      course,
      courseDirectory,
      fileName: "foundation-map.png",
    })).rejects.toMatchObject({ category: "asset-integrity" });
  });

  it("accepts a verified v5 course without figures", async () => {
    const courseDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "course-assets-empty-"));
    directories.push(courseDirectory);
    const course = makeUniversalCourse();
    course.schemaVersion = 5;
    course.source.artifactAudit = { status: "verified", artifactCount: 0 };
    course.sourceArtifacts = [];

    await expect(validateCourseAssets({ course, courseDirectory }))
      .resolves.toEqual({
        checkedImages: 0,
        checkedFiles: 0,
        totalBytes: 0,
        fileCounts: { image: 0, video: 0, audio: 0, pdf: 0, download: 0 },
        checkedSubtitleFiles: 0,
        subtitleBytes: 0,
      });
  });

  it("checks covered figures and ignores excluded figures", async () => {
    const { course, courseDirectory } = await makeHarness();
    expect(await validateCourseAssets({ course, courseDirectory }))
      .toEqual({
        checkedImages: 1,
        checkedFiles: 1,
        totalBytes: png.length,
        fileCounts: { image: 1, video: 0, audio: 0, pdf: 0, download: 0 },
        checkedSubtitleFiles: 0,
        subtitleBytes: 0,
      });

    course.sourceArtifacts[0].coverage = "excluded";
    course.sourceArtifacts[0].unitIds = [];
    course.sourceArtifacts[0].exclusionReason = "Схема не нужна для учебной цели.";
    await fs.rm(path.join(courseDirectory, "assets", "foundation-map.png"));

    expect(await validateCourseAssets({ course, courseDirectory }))
      .toEqual({
        checkedImages: 0,
        checkedFiles: 0,
        totalBytes: 0,
        fileCounts: { image: 0, video: 0, audio: 0, pdf: 0, download: 0 },
        checkedSubtitleFiles: 0,
        subtitleBytes: 0,
      });
  });
});

describe("course file assets", () => {
  it("opens one verified v6 video descriptor without buffering it", async () => {
    const { course, courseDirectory } = await makeFileHarness();
    const asset = await openCourseAsset({
      course,
      courseDirectory,
      fileName: "demo.webm",
    });

    expect(asset).toMatchObject({
      contentType: "video/webm",
      presentation: "video",
      sizeBytes: webm.length,
      originalName: "Demo.webm",
    });
    expect(asset.filePath).toContain("demo.webm");
    expect(asset).not.toHaveProperty("buffer");
  });

  it("rejects a v6 file whose declared size is wrong", async () => {
    const { course, courseDirectory } = await makeFileHarness();
    course.sourceArtifacts[1].content.sizeBytes += 1;

    await expect(openCourseAsset({ course, courseDirectory, fileName: "demo.webm" }))
      .rejects.toMatchObject({ category: "asset-integrity" });
  });

  it("reports all v6 files by presentation and bytes", async () => {
    const { course, courseDirectory } = await makeFileHarness();
    for (const artifact of course.sourceArtifacts.slice(0, 5)) {
      if (artifact.id === "video-demo") continue;
      const buffer = artifact.id === "figure-animated-demo"
        ? Buffer.from("47494638396101000100", "hex")
        : artifact.id === "audio-demo"
          ? Buffer.from("4f676753000200000000", "hex")
          : artifact.id === "document-demo"
            ? Buffer.from("255044462d312e370a", "hex")
            : Buffer.from("504b030414000000", "hex");
      artifact.content.sizeBytes = buffer.length;
      artifact.content.sha256 = sha256(buffer);
      await fs.writeFile(path.join(courseDirectory, "assets", artifact.content.fileName), buffer);
    }
    const report = await validateCourseAssets({ course, courseDirectory });
    expect(report).toEqual({
      checkedImages: 1,
      checkedFiles: 5,
      totalBytes: course.sourceArtifacts.reduce((sum, artifact) => sum + artifact.content.sizeBytes, 0),
      fileCounts: { image: 1, video: 1, audio: 1, pdf: 1, download: 1 },
      checkedSubtitleFiles: 0,
      subtitleBytes: 0,
    });
  });
});
