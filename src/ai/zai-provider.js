import { AiResponseSchema } from "./provider-contract.js";

const DEFAULT_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions";

const WEB_POLICY = [
  "Материал курса остаётся основной опорой ответа.",
  "Используй веб-поиск только для актуальных, изменяемых или явно запрошенных внешних сведений.",
  "Не используй веб-поиск для обычного пересказа уже переданного материала.",
  "Если использовал интернет, укажи названия источников и прямые URL внутри ответа.",
  "Если актуальные сведения нельзя проверить, сообщи об этом явно.",
].join(" ");

function wrappedError(category, message, cause) {
  return Object.assign(new Error(message, { cause }), { category });
}

function parseJson(text, expectedKind) {
  const cleaned = String(text ?? "").trim()
    .replace(/^```json\s*/u, "")
    .replace(/\s*```$/u, "");
  const parsed = AiResponseSchema.parse(JSON.parse(cleaned));
  if (parsed.kind !== expectedKind) throw new Error("Unexpected AI response kind");
  return parsed;
}

function extractError(response, payload) {
  const detail = payload?.error ?? payload ?? {};
  return {
    status: response.status,
    code: detail.code,
    message: detail.message ?? detail.error ?? "",
  };
}

function mcpTools(apiKey) {
  return [
    {
      type: "mcp",
      mcp: {
        server_label: "web-search-prime",
        server_url: "https://api.z.ai/api/mcp/web_search_prime/mcp",
        transport_type: "streamable-http",
        headers: { Authorization: `Bearer ${apiKey}` },
        allowed_tools: ["webSearchPrime"],
      },
    },
    {
      type: "mcp",
      mcp: {
        server_label: "web-reader",
        server_url: "https://api.z.ai/api/mcp/web_reader/mcp",
        transport_type: "streamable-http",
        headers: { Authorization: `Bearer ${apiKey}` },
        allowed_tools: ["webReader"],
      },
    },
  ];
}

export function classifyZaiError(error) {
  const status = Number(error?.status);
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? error ?? "").toLowerCase();

  if (error?.name === "TimeoutError" || error?.name === "AbortError" || message.includes("timeout")) {
    return "zai-timeout";
  }
  if (status === 401 || code === "401" || /auth|unauthori[sz]ed|api key|invalid key/u.test(message)) {
    return "zai-auth";
  }
  if (code === "1302" || code === "1303") return "zai-rate-limit";
  if (code === "1313" || message.includes("fair use")) return "zai-fair-use";
  if (/websearchprime|web reader|webreader|\bmcp\b/u.test(message)) return "zai-web-unavailable";
  if (/model.*(not found|unavailable)|model not found/u.test(message)) {
    return "zai-model-unavailable";
  }
  if (/quota|credit|weekly|five-hour|five hour|balance/u.test(message)) return "zai-quota";
  return "zai-unavailable";
}

export function createZaiProvider({
  apiKey,
  model,
  reasoningEffort = null,
  thinkingEnabled = true,
  timeoutMs = 240_000,
  fetchImpl = fetch,
  endpoint = DEFAULT_ENDPOINT,
} = {}) {
  const key = String(apiKey ?? "").trim();

  return {
    async generate(prompt, expectedKind) {
      if (!key) throw wrappedError("zai-key-missing", "Z.AI key is missing");

      const body = {
        model,
        messages: [
          { role: "system", content: WEB_POLICY },
          { role: "user", content: prompt },
        ],
        stream: false,
        thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        response_format: { type: "json_object" },
        tools: mcpTools(key),
        tool_choice: "auto",
      };

      let lastInvalidError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          throw wrappedError(classifyZaiError(error), "Z.AI request failed", error);
        }

        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          throw wrappedError("zai-invalid-response", "Z.AI returned invalid JSON", error);
        }
        if (!response.ok) {
          const error = extractError(response, payload);
          throw wrappedError(classifyZaiError(error), "Z.AI request failed", error);
        }

        try {
          return parseJson(payload?.choices?.[0]?.message?.content, expectedKind);
        } catch (error) {
          lastInvalidError = error;
        }
      }

      throw wrappedError(
        "zai-invalid-response",
        "Z.AI returned invalid structured data after one retry",
        lastInvalidError,
      );
    },
  };
}
