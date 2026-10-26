import { describe, expect, it } from "vitest";
import { assertSupportedPresentation } from "../src/content/course-asset-formats.js";

const headers = {
  gif: Buffer.from("47494638396101000100", "hex"),
  webm: Buffer.from("1a45dfa39f42868101", "hex"),
  mp4: Buffer.from("000000186674797069736f6d00000000", "hex"),
  ogg: Buffer.from("4f676753000200000000", "hex"),
  wav: Buffer.from("524946462400000057415645", "hex"),
  mp3: Buffer.from("49443304000000000000", "hex"),
  pdf: Buffer.from("255044462d312e370a", "hex"),
  zip: Buffer.from("504b030414000000", "hex"),
};

function content(fileName, mimeType, presentation) {
  return { fileName, mimeType, presentation };
}

describe("course asset formats", () => {
  it("accepts every supported inline format by its signature", () => {
    expect(assertSupportedPresentation(content("demo.gif", "image/gif", "image"), headers.gif).inline).toBe(true);
    expect(assertSupportedPresentation(content("demo.webm", "video/webm", "video"), headers.webm).inline).toBe(true);
    expect(assertSupportedPresentation(content("demo.mp4", "video/mp4", "video"), headers.mp4).inline).toBe(true);
    expect(assertSupportedPresentation(content("demo.ogg", "audio/ogg", "audio"), headers.ogg).inline).toBe(true);
    expect(assertSupportedPresentation(content("demo.wav", "audio/wav", "audio"), headers.wav).inline).toBe(true);
    expect(assertSupportedPresentation(content("demo.mp3", "audio/mpeg", "audio"), headers.mp3).inline).toBe(true);
    expect(assertSupportedPresentation(content("guide.pdf", "application/pdf", "pdf"), headers.pdf).inline).toBe(true);
  });

  it("accepts unknown files only as downloads", () => {
    expect(assertSupportedPresentation(content("examples.zip", "application/zip", "download"), headers.zip))
      .toEqual({ responseType: "application/octet-stream", inline: false });
  });

  it("rejects mismatched presentation, MIME and signature", () => {
    expect(() => assertSupportedPresentation(content("demo.html", "text/html", "image"), Buffer.from("<html>")))
      .toThrow(/match/u);
    expect(() => assertSupportedPresentation(content("demo.mp4", "video/mp4", "video"), headers.pdf))
      .toThrow(/match/u);
    expect(() => assertSupportedPresentation(content("demo.zip", "application/zip", "image"), headers.zip))
      .toThrow(/match/u);
  });
});
