import { callClaude } from "./claude";
import { callGemini } from "./gemini";
import { CLAUDE_MAX_MS, GEMINI_MAX_MS, RUN_BUDGET_MS, callTimeoutMs } from "./budget";
import { ProviderUnavailableError, type ReviewJSON } from "./types";

export type LlmKeys = {
  gemini?: { apiKey: string; model: string };
  claude?: { apiKey: string; model: string };
};

export type RunOptions = {
  // Wall-clock time (ms) by which the AI work must be done, so the run can still reply.
  deadlineAt?: number;
  // Try Claude before Gemini (used after Gemini failed on the same commit).
  claudeFirst?: boolean;
};

// Thrown when every provider failed or there was no time left. `provider` is the one that
// failed last, so the next attempt can start with the other one.
export class AiReviewError extends Error {
  constructor(message: string, public lastProvider: "gemini" | "claude" | "none") {
    super(message);
  }
}

// Gemini is primary. Claude runs when Gemini can't serve right now (key, billing, quota,
// overload, timeout, unusable answer) or when no Gemini key is saved. Each call's timeout
// fits inside the run's deadline.
export async function runReview(keys: LlmKeys, systemPrompt: string, userPrompt: string, opts: RunOptions = {}): Promise<ReviewJSON> {
  const deadlineAt = opts.deadlineAt ?? Date.now() + RUN_BUDGET_MS;
  if (!keys.gemini && !keys.claude) throw new AiReviewError("No AI key saved. Run /setup.", "none");

  type Step = { name: "gemini" | "claude"; run: (timeoutMs: number) => Promise<ReviewJSON>; max: number };
  const gemini: Step | null = keys.gemini
    ? { name: "gemini", run: (t) => callGemini(keys.gemini!.apiKey, keys.gemini!.model, systemPrompt, userPrompt, t), max: GEMINI_MAX_MS }
    : null;
  const claude: Step | null = keys.claude
    ? { name: "claude", run: (t) => callClaude(keys.claude!.apiKey, keys.claude!.model, systemPrompt, userPrompt, t), max: CLAUDE_MAX_MS }
    : null;
  const order = (opts.claudeFirst ? [claude, gemini] : [gemini, claude]).filter((s): s is Step => s !== null);

  const errors: string[] = [];
  let lastProvider: "gemini" | "claude" | "none" = "none";
  for (let i = 0; i < order.length; i++) {
    const step = order[i]!;
    const timeout = callTimeoutMs(deadlineAt, Date.now(), step.max);
    if (timeout === 0) {
      errors.push(`no time left in this run for ${step.name === "gemini" ? "Gemini" : "Claude"}`);
      break;
    }
    try {
      return await step.run(timeout);
    } catch (e) {
      lastProvider = step.name;
      errors.push((e as Error).message);
      const canFallBack = e instanceof ProviderUnavailableError && i < order.length - 1;
      if (!canFallBack) break;
      console.warn(`${step.name} unavailable, trying ${order[i + 1]!.name}: ${(e as Error).message}`);
    }
  }
  throw new AiReviewError(errors.join("; "), lastProvider);
}
