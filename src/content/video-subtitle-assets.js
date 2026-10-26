import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

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

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function openVideoSubtitleAsset({ courseDirectory, subtitleAsset }) {
  const fileName = subtitleAsset.fileName;
  if (typeof fileName !== "string"
    || fileName.length === 0
    || path.basename(fileName) !== fileName
    || path.win32.basename(fileName) !== fileName) {
    throw assetError("invalid-asset-request", "Unsafe subtitle file name");
  }

  try {
    const assetsRoot = await fs.realpath(path.resolve(courseDirectory, "assets"));
    const candidate = path.join(assetsRoot, fileName);
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw assetError("asset-integrity", "Subtitle asset is not a regular file");
    }
    const realFile = await fs.realpath(candidate);
    if (!isInside(assetsRoot, realFile)) {
      throw assetError("asset-integrity", "Subtitle asset escaped its asset root");
    }
    if (subtitleAsset.sizeBytes !== stat.size) {
      throw assetError("asset-integrity", "Subtitle asset size does not match");
    }
    const sha256 = await hashFile(realFile);
    const expectedHash = Buffer.from(subtitleAsset.sha256, "hex");
    const actualHash = Buffer.from(sha256, "hex");
    if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
      throw assetError("asset-integrity", "Subtitle asset hash does not match");
    }
    const raw = await fs.readFile(realFile);
    const text = raw.toString("utf8");
    const stripped = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    if (!stripped.startsWith("WEBVTT")) {
      throw assetError("asset-integrity", "Subtitle asset is not a valid WebVTT file");
    }
    return {
      filePath: realFile,
      sizeBytes: stat.size,
      sha256,
      language: subtitleAsset.language,
    };
  } catch (error) {
    if (error?.category) throw error;
    if (error?.code === "ENOENT") {
      throw assetError("asset-not-found", "Subtitle asset file is missing", error);
    }
    throw assetError("asset-integrity", "Subtitle asset cannot be verified", error);
  }
}

export async function validateVideoSubtitleAssets({ course, courseDirectory }) {
  const ready = course.schemaVersion === 7
    && course.videoSource.materialMode !== "embedded-only"
    ? course.videoSource.chapters.filter(({ status }) => status === "ready")
    : [];
  let subtitleBytes = 0;
  for (const chapter of ready) {
    const asset = await openVideoSubtitleAsset({
      courseDirectory,
      subtitleAsset: chapter.subtitleAsset,
    });
    subtitleBytes += asset.sizeBytes;
  }
  return { checkedSubtitleFiles: ready.length, subtitleBytes };
}
