import { describe, expect, it } from "vitest";
import { parseSingleRange } from "../src/http/course-asset-response.js";

describe("course asset ranges", () => {
  it("parses full, open-ended and suffix ranges", () => {
    expect(parseSingleRange(undefined, 100)).toBeNull();
    expect(parseSingleRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseSingleRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseSingleRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("rejects invalid and multi-part ranges", () => {
    expect(() => parseSingleRange("bytes=100-120", 100))
      .toThrowError(expect.objectContaining({ category: "asset-range" }));
    expect(() => parseSingleRange("bytes=0-1,4-5", 100))
      .toThrowError(expect.objectContaining({ category: "asset-range" }));
  });
});
