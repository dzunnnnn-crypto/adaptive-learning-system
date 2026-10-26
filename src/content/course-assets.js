import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertSupportedPresentation,
  legacyImageContent,
} from "./course-asset-formats.js";
import { validateVideoSubtitleAssets } from "./video-subtitle-assets.js";

const integrityCache = new Map();

function assetError(category, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { category });
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && !relative.startsWith(`..${path.sep}`)
    && relative !== ".."
    && !path.isAbsolute(relative);
}

function declaredAsset(course, fileName) {
  return (course.sourceArtifacts ?? []).find((artifact) => (
    artifact.coverage === "covered"
    && ((artifact.kind === "figure" && artifact.content?.type === "image")
      || artifact.content?.type === "file")
    && artifact.content.fileName === fileName
  ));
}

async function readHeader(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function normalizedContent(artifact) {
  if (artifact.content.type === "image") return legacyImageContent(artifact.content);
  return artifact.content;
}

export async function openCourseAsset({ course, courseDirectory, fileName }) {
  if (typeof fileName !== "string"
    || fileName.length === 0
    || path.basename(fileName) !== fileName
    || path.win32.basename(fileName) !== fileName) {
    throw assetError("invalid-asset-request", "Unsafe asset file name");
  }

  const artifact = declaredAsset(course, fileName);
  if (!artifact) throw assetError("asset-not-found", "Unknown course asset");
  const content = normalizedContent(artifact);

  try {
    const assetsRoot = await fs.realpath(path.resolve(courseDirectory, "assets"));
    const candidate = path.join(assetsRoot, fileName);
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw assetError("asset-integrity", "Course asset is not a regular file");
    }
    const realFile = await fs.realpath(candidate);
    if (!isInside(assetsRoot, realFile)) {
      throw assetError("asset-integrity", "Course asset escaped its asset root");
    }
    if (content.sizeBytes !== undefined && content.sizeBytes !== stat.size) {
      throw assetError("asset-integrity", "Course asset size does not match");
    }
    let format;
    try {
      format = assertSupportedPresentation(content, await readHeader(realFile));
    } catch (error) {
      if (error?.category === "asset-format") {
        throw assetError("asset-integrity", error.message, error);
      }
      throw error;
    }
    const cacheKey = `${realFile}\u0000${stat.size}\u0000${stat.mtimeMs}`;
    let sha256 = integrityCache.get(cacheKey);
    if (!sha256) {
      sha256 = await hashFile(realFile);
      integrityCache.set(cacheKey, sha256);
    }
    const expectedHash = Buffer.from(content.sha256, "hex");
    const actualHash = Buffer.from(sha256, "hex");
    if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
      throw assetError("asset-integrity", "Course asset hash does not match");
    }

    return {
      filePath: realFile,
      contentType: format.responseType,
      inline: format.inline,
      presentation: content.presentation,
      originalName: content.originalName,
      sizeBytes: stat.size,
      sha256,
    };
  } catch (error) {
    if (error?.category) throw error;
    if (error?.code === "ENOENT") {
      throw assetError("asset-not-found", "Course asset file is missing", error);
    }
    throw assetError("asset-integrity", "Course asset cannot be verified", error);
  }
}

export async function readCourseAsset(options) {
  const descriptor = await openCourseAsset(options);
  return {
    buffer: await fs.readFile(descriptor.filePath),
    contentType: descriptor.contentType,
    sha256: descriptor.sha256,
  };
}

export async function validateCourseAssets({ course, courseDirectory }) {
  const assets = (course.sourceArtifacts ?? []).filter((artifact) => (
    artifact.coverage === "covered"
    && ((artifact.kind === "figure" && artifact.content?.type === "image")
      || artifact.content?.type === "file")
  ));
  const report = {
    checkedImages: 0,
    checkedFiles: 0,
    totalBytes: 0,
    fileCounts: { image: 0, video: 0, audio: 0, pdf: 0, download: 0 },
  };
  for (const artifact of assets) {
    const asset = await openCourseAsset({
      course,
      courseDirectory,
      fileName: artifact.content.fileName,
    });
    report.checkedFiles += 1;
    report.totalBytes += asset.sizeBytes;
    report.fileCounts[asset.presentation] += 1;
    if (asset.presentation === "image") report.checkedImages += 1;
  }
  const subtitles = await validateVideoSubtitleAssets({ course, courseDirectory });
  return { ...report, ...subtitles };
}
