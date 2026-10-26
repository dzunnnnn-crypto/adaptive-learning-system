import { describe, expect, it, vi } from "vitest";
import { LearningService } from "../src/application/learning-service.js";
import { createInitialState } from "../src/domain/lesson-state.js";
import { makeUniversalCourse } from "./fixtures/universal-course.js";
import { API_VERSION } from "../src/app-identity.js";

function makeService(state) {
  const course = makeUniversalCourse();
  const store = { load: vi.fn(async () => structuredClone(state)), save: vi.fn() };
  return new LearningService({
    course,
    store,
    provider: { generate: vi.fn() },
    promptBuilder: vi.fn(),
  });
}

describe("universal learning service view", () => {
  it("allows increasing beyond five fragments before the article end", async () => {
    const course = makeUniversalCourse();
    const view = await makeService(createInitialState(course, { targetSize: 5 })).getView();

    expect(view).toMatchObject({
      apiVersion: API_VERSION,
      actualSize: 5,
      canIncrease: true,
      canDecrease: true,
      sizeLimitReason: null,
    });
  });

  it("reports the actual article end when no fragments remain outside the block", async () => {
    const course = makeUniversalCourse();
    const view = await makeService(createInitialState(course, { cursor: 5, targetSize: 5 })).getView();

    expect(view).toMatchObject({
      actualSize: 2,
      canIncrease: false,
      sizeLimitReason: "article-end",
    });
  });
});
