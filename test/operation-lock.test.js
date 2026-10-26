import { describe, expect, it } from "vitest";
import { createOperationLock } from "../src/application/operation-lock.js";

describe("operation lock", () => {
  it("runs state mutations in submission order and releases after failure", async () => {
    const lock = createOperationLock();
    const events = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const first = lock.run(async () => {
      events.push("first-start");
      await gate;
      events.push("first-end");
      throw new Error("failed");
    });
    const second = lock.run(async () => {
      events.push("second");
      return "done";
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    release();
    await expect(first).rejects.toThrow("failed");
    await expect(second).resolves.toBe("done");
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });
});
