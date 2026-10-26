import { describe, expect, it, vi } from "vitest";

async function loadProvider() {
  return import("../src/ai/zai-provider.js");
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

const validClarification = JSON.stringify({
  kind: "clarification",
  answer: "Проверенный ответ с прямой ссылкой на официальный источник.",
  basis: "mixed",
});

describe("Z.AI provider", () => {
  it("sends GLM 5.2 Max with both official web MCP tools", async () => {
    const { createZaiProvider } = await loadProvider();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: validClarification } }],
    }));
    const provider = createZaiProvider({
      apiKey: "test-key",
      model: "glm-5.2",
      reasoningEffort: "max",
      thinkingEnabled: true,
      timeoutMs: 240_000,
      fetchImpl,
    });

    await expect(provider.generate("Проверь актуальные сведения.", "clarification"))
      .resolves.toEqual(JSON.parse(validClarification));

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
    expect(options.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      model: "glm-5.2",
      stream: false,
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      response_format: { type: "json_object" },
      tool_choice: "auto",
    });
    expect(body.messages[0].content).toContain("Материал курса");
    expect(body.messages[0].content).toContain("прямые URL");
    expect(body.tools).toEqual([
      {
        type: "mcp",
        mcp: {
          server_label: "web-search-prime",
          server_url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
          transport_type: "streamable-http",
          headers: { Authorization: "Bearer test-key" },
          allowed_tools: ["webSearchPrime"],
        },
      },
      {
        type: "mcp",
        mcp: {
          server_label: "web-reader",
          server_url: "https://api.z.ai/api/mcp/web_reader/mcp",
          transport_type: "streamable-http",
          headers: { Authorization: "Bearer test-key" },
          allowed_tools: ["webReader"],
        },
      },
    ]);
  });

  it("enables thinking for GLM 5 Turbo without a Max reasoning setting", async () => {
    const { createZaiProvider } = await loadProvider();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: validClarification } }],
    }));
    const provider = createZaiProvider({
      apiKey: "test-key",
      model: "glm-5-turbo",
      reasoningEffort: null,
      thinkingEnabled: true,
      timeoutMs: 180_000,
      fetchImpl,
    });

    await provider.generate("Перескажи материал.", "clarification");

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.model).toBe("glm-5-turbo");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("retries exactly once after an invalid structured answer", async () => {
    const { createZaiProvider } = await loadProvider();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "not json" } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: validClarification } }] }));
    const provider = createZaiProvider({
      apiKey: "test-key",
      model: "glm-5.2",
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(provider.generate("Проверка", "clarification"))
      .resolves.toEqual(JSON.parse(validClarification));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a missing key before making a request", async () => {
    const { createZaiProvider } = await loadProvider();
    const fetchImpl = vi.fn();
    const provider = createZaiProvider({ apiKey: "   ", model: "glm-5.2", fetchImpl });

    await expect(provider.generate("Проверка", "clarification"))
      .rejects.toMatchObject({ category: "zai-key-missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies Z.AI failures without exposing provider details", async () => {
    const { classifyZaiError } = await loadProvider();

    expect(classifyZaiError({ status: 401, message: "bad auth" })).toBe("zai-auth");
    expect(classifyZaiError({ code: 1302, message: "high concurrency" })).toBe("zai-rate-limit");
    expect(classifyZaiError({ code: 1303, message: "rate limit" })).toBe("zai-rate-limit");
    expect(classifyZaiError({ code: 1313, message: "fair use" })).toBe("zai-fair-use");
    expect(classifyZaiError({ message: "weekly quota exhausted" })).toBe("zai-quota");
    expect(classifyZaiError({ message: "model not found" })).toBe("zai-model-unavailable");
    expect(classifyZaiError({ message: "webSearchPrime MCP unavailable" })).toBe("zai-web-unavailable");
    expect(classifyZaiError({ name: "TimeoutError", message: "timeout" })).toBe("zai-timeout");
    expect(classifyZaiError({ message: "network down" })).toBe("zai-unavailable");
  });
});
