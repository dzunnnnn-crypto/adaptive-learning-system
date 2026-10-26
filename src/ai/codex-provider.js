import { Codex } from "@openai/codex-sdk";
import { AiResponseSchema } from "./provider-contract.js";

function parseJson(text, expectedKind) {
  const cleaned = text.trim()
    .replace(/^```json\s*/u, "")
    .replace(/\s*```$/u, "");
  const parsed = AiResponseSchema.parse(JSON.parse(cleaned));
  if (parsed.kind !== expectedKind) throw new Error("Unexpected AI response kind");
  return parsed;
}

function runWithTimeout(thread, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Codex request timeout")), timeoutMs);
    thread.run(prompt).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function classifyCodexError(error) {
  const message = String(error?.message ?? error).toLowerCase();
  if (
    message.includes("enoent")
    || message.includes("not found")
    || message.includes("could not spawn")
    || message.includes("unable to locate")
  ) {
    return "not-installed";
  }
  if (message.includes("login") || message.includes("auth") || message.includes("unauthorized")) {
    return "auth";
  }
  if (message.includes("limit") || message.includes("quota") || message.includes("credit")) {
    return "quota";
  }
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  return "unavailable";
}

export function createCodexProvider({
  createCodex = () => new Codex(),
  workingDirectory = process.cwd(),
  model,
  modelReasoningEffort,
  timeoutMs = 90_000,
} = {}) {
  return {
    async generate(prompt, expectedKind) {
      let thread;
      try {
        const codex = createCodex();
        thread = codex.startThread({
          workingDirectory,
          ...(model === undefined ? {} : { model }),
          ...(modelReasoningEffort === undefined ? {} : { modelReasoningEffort }),
          skipGitRepoCheck: true,
          sandboxMode: "read-only",
          approvalPolicy: "never",
          networkAccessEnabled: false,
          webSearchMode: "live",
        });
      } catch (error) {
        const wrapped = new Error("Codex could not start", { cause: error });
        wrapped.category = classifyCodexError(error);
        throw wrapped;
      }
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let result;
        try {
          result = await runWithTimeout(thread, prompt, timeoutMs);
        } catch (error) {
          const wrapped = new Error("Codex request failed", { cause: error });
          wrapped.category = classifyCodexError(error);
          throw wrapped;
        }
        try {
          return parseJson(result.finalResponse, expectedKind);
        } catch (error) {
          lastError = error;
        }
      }
      const wrapped = new Error(
        "Codex returned invalid structured data after one retry",
        { cause: lastError },
      );
      wrapped.category = "invalid-response";
      throw wrapped;
    },
  };
}
