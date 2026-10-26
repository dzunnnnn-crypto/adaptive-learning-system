import fs from "node:fs";

function rangeError(sizeBytes) {
  return Object.assign(new Error("Invalid asset byte range"), {
    category: "asset-range",
    sizeBytes,
  });
}

export function parseSingleRange(header, sizeBytes) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2])) throw rangeError(sizeBytes);
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw rangeError(sizeBytes);
    start = Math.max(0, sizeBytes - suffix);
    end = sizeBytes - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : sizeBytes - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || start >= sizeBytes || end < start) throw rangeError(sizeBytes);
  return { start, end: Math.min(end, sizeBytes - 1) };
}

function encodedFileName(name) {
  return encodeURIComponent(name).replace(/[!'()*]/gu, (char) => (
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

export function sendCourseAsset(request, response, asset) {
  const range = parseSingleRange(request.headers.range, asset.sizeBytes);
  const download = asset.presentation === "download";
  response
    .set("Content-Type", download ? "application/octet-stream" : asset.contentType)
    .set("X-Content-Type-Options", "nosniff")
    .set("Cache-Control", "private, max-age=31536000, immutable")
    .set("ETag", `"${asset.sha256}"`)
    .set("Accept-Ranges", "bytes");
  if (download) {
    response.set("Content-Disposition", `attachment; filename*=UTF-8''${encodedFileName(asset.originalName)}`);
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? asset.sizeBytes - 1;
  response.status(range ? 206 : 200).set("Content-Length", String(end - start + 1));
  if (range) response.set("Content-Range", `bytes ${start}-${end}/${asset.sizeBytes}`);
  if (request.method === "HEAD") return response.end();
  return fs.createReadStream(asset.filePath, { start, end }).pipe(response);
}
