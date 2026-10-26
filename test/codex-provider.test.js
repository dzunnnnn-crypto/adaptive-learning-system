import { describe, expect, it, vi } from "vitest";
import { createCodexProvider } from "../src/ai/codex-provider.js";

function fakeCodex(responses) {
  const run = vi.fn();
  responses.forEach((response) => run.mockResolvedValueOnce({ finalResponse: response }));
  const startThread = vi.fn(() => ({ run }));
  return { startThread, run };
}

describe("Codex provider", () => {
  it("parses a valid structured response", async () => {
    const fake = fakeCodex([
      '{"kind":"detail","explanation":"Подробное объяснение материала.","example":"Конкретный рабочий пример.","caveat":"Важное ограничение подхода."}',
    ]);
    const provider = createCodexProvider({ createCodex: () => fake });
    const result = await provider.generate("prompt", "detail");
    expect(result.kind).toBe("detail");
  });

  it("parses a structured clarification response", async () => {
    const fake = fakeCodex([
      '{"kind":"clarification","answer":"Проектное правило действует только в нужной рабочей области.","basis":"mixed"}',
    ]);
    const provider = createCodexProvider({ createCodex: () => fake });
    await expect(provider.generate("prompt", "clarification")).resolves.toEqual({
      kind: "clarification",
      answer: "Проектное правило действует только в нужной рабочей области.",
      basis: "mixed",
    });
  });

  it("starts a read-only thread with live web search but no command network", async () => {
    const fake = fakeCodex([
      '{"kind":"detail","explanation":"Подробное объяснение материала.","example":"Конкретный рабочий пример.","caveat":"Важное ограничение подхода."}',
    ]);
    const provider = createCodexProvider({
      createCodex: () => fake,
      workingDirectory: "C:\\course",
    });
    await provider.generate("prompt", "detail");
    expect(fake.startThread).toHaveBeenCalledWith({
      workingDirectory: "C:\\course",
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "live",
    });
  });

  it("passes Terra Medium model settings to the Codex thread", async () => {
    const fake = fakeCodex([
      '{"kind":"detail","explanation":"Подробное объяснение материала.","example":"Конкретный рабочий пример.","caveat":"Важное ограничение подхода."}',
    ]);
    const provider = createCodexProvider({
      createCodex: () => fake,
      workingDirectory: "C:\\course",
      model: "gpt-5.6-terra",
      modelReasoningEffort: "medium",
    });

    await provider.generate("prompt", "detail");

    expect(fake.startThread).toHaveBeenCalledWith({
      workingDirectory: "C:\\course",
      model: "gpt-5.6-terra",
      modelReasoningEffort: "medium",
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "live",
    });
  });

  it("passes Sol Very High model settings to the Codex thread", async () => {
    const fake = fakeCodex([
      '{"kind":"detail","explanation":"Подробное объяснение материала.","example":"Конкретный рабочий пример.","caveat":"Важное ограничение подхода."}',
    ]);
    const provider = createCodexProvider({
      createCodex: () => fake,
      model: "gpt-5.6-sol",
      modelReasoningEffort: "xhigh",
    });

    await provider.generate("prompt", "detail");

    expect(fake.startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-sol",
      modelReasoningEffort: "xhigh",
    }));
  });

  it("retries once after an invalid response", async () => {
    const fake = fakeCodex([
      "not json",
      '{"kind":"rephrase","explanation":"Совсем другое подробное объяснение.","analogy":"Понятная бытовая аналогия.","suggestSmaller":true}',
    ]);
    const provider = createCodexProvider({ createCodex: () => fake });
    const result = await provider.generate("prompt", "rephrase");
    expect(result.kind).toBe("rephrase");
    expect(fake.run).toHaveBeenCalledTimes(2);
  });

  it("rejects a valid response of the wrong operation kind", async () => {
    const response = '{"kind":"practice","task":"Выполни короткую задачу по текущему материалу.","expectedMinutes":3,"evaluationGuide":"Проверь конкретный результат."}';
    const fake = fakeCodex([response, response]);
    const provider = createCodexProvider({ createCodex: () => fake });
    await expect(provider.generate("prompt", "detail"))
      .rejects.toMatchObject({ category: "invalid-response" });
    expect(fake.run).toHaveBeenCalledTimes(2);
  });

  it("returns a timeout category for a non-resolving turn", async () => {
    const run = vi.fn(() => new Promise(() => {}));
    const fake = { startThread: vi.fn(() => ({ run })) };
    const provider = createCodexProvider({ createCodex: () => fake, timeoutMs: 1 });
    await expect(provider.generate("prompt", "detail"))
      .rejects.toMatchObject({ category: "timeout" });
  });

  it("allows live web searches longer than 45 seconds by default", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(() => new Promise(() => {}));
      const fake = { startThread: vi.fn(() => ({ run })) };
      const provider = createCodexProvider({ createCodex: () => fake });
      const outcome = provider.generate("prompt", "detail")
        .then(() => "resolved", (error) => error.category);

      await vi.advanceTimersByTimeAsync(45_000);
      await expect(Promise.race([outcome, Promise.resolve("pending")]))
        .resolves.toBe("pending");

      await vi.advanceTimersByTimeAsync(45_000);
      await expect(outcome).resolves.toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies a missing CLI binary before the thread starts", async () => {
    const provider = createCodexProvider({
      createCodex: () => {
        throw new Error("Unable to locate Codex CLI binaries");
      },
    });
    await expect(provider.generate("prompt", "detail"))
      .rejects.toMatchObject({ category: "not-installed" });
  });
});
