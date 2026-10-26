import path from "node:path";

export const INLINE_FORMATS = new Map([
  [".png", { mimeType: "image/png", presentation: "image", signature: "png" }],
  [".jpg", { mimeType: "image/jpeg", presentation: "image", signature: "jpeg" }],
  [".jpeg", { mimeType: "image/jpeg", presentation: "image", signature: "jpeg" }],
  [".webp", { mimeType: "image/webp", presentation: "image", signature: "webp" }],
  [".gif", { mimeType: "image/gif", presentation: "image", signature: "gif" }],
  [".mp4", { mimeType: "video/mp4", presentation: "video", signature: "iso-media" }],
  [".webm", { mimeType: "video/webm", presentation: "video", signature: "webm" }],
  [".mp3", { mimeType: "audio/mpeg", presentation: "audio", signature: "mp3" }],
  [".m4a", { mimeType: "audio/mp4", presentation: "audio", signature: "iso-media" }],
  [".ogg", { mimeType: "audio/ogg", presentation: "audio", signature: "ogg" }],
  [".wav", { mimeType: "audio/wav", presentation: "audio", signature: "wav" }],
  [".pdf", { mimeType: "application/pdf", presentation: "pdf", signature: "pdf" }],
]);

function assetFormatError(message) {
  return Object.assign(new Error(message), { category: "asset-format" });
}

function startsWith(buffer, hex) {
  const signature = Buffer.from(hex, "hex");
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

export function detectSignature(buffer) {
  if (startsWith(buffer, "89504e470d0a1a0a")) return "png";
  if (startsWith(buffer, "ffd8ff")) return "jpeg";
  if (startsWith(buffer, "4749463837") || startsWith(buffer, "4749463839")) return "gif";
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (startsWith(buffer, "1a45dfa3")) return "webm";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return "iso-media";
  if (startsWith(buffer, "4f676753")) return "ogg";
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WAVE") return "wav";
  if (startsWith(buffer, "255044462d")) return "pdf";
  if (startsWith(buffer, "494433")) return "mp3";
  for (let index = 0; index + 1 < buffer.length; index += 1) {
    if (buffer[index] === 0xff && (buffer[index + 1] & 0xe0) === 0xe0) return "mp3";
  }
  return null;
}

export function assertSupportedPresentation(content, header) {
  if (content.presentation === "download") {
    return { responseType: "application/octet-stream", inline: false };
  }
  const extension = path.extname(content.fileName).toLowerCase();
  const expected = INLINE_FORMATS.get(extension);
  if (!expected
    || expected.mimeType !== content.mimeType
    || expected.presentation !== content.presentation
    || detectSignature(header) !== expected.signature) {
    throw assetFormatError("Asset extension, MIME, presentation and signature do not match");
  }
  return { responseType: expected.mimeType, inline: true };
}

export function legacyImageContent(content) {
  const extension = path.extname(content.fileName).toLowerCase();
  const format = INLINE_FORMATS.get(extension);
  if (!format || format.presentation !== "image") {
    throw assetFormatError("Legacy image has an unsupported extension");
  }
  return {
    fileName: content.fileName,
    originalName: content.fileName,
    mimeType: format.mimeType,
    sha256: content.sha256,
    presentation: "image",
  };
}
