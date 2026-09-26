import { callClaude } from "./claude";
import { callGemini } from "./gemini";
import { ProviderUnavailableError, type ReviewJSON } from "./types";

export type LlmKeys = {
  gemini?: { apiKey: string; model: string };
  claude?: { apiKey: string; model: string };
};

// Gemini is primary. Claude runs only when Gemini can't serve right now
// (rate limit, quota, overload, timeout) or when no Gemini key is saved.
export async function runReview(keys: LlmKeys, systemPrompt: string, userPrompt: string): Promise<ReviewJSON> {
  if (keys.gemini) {
    try {
      return await callGemini(keys.gemini.apiKey, keys.gemini.model, systemPrompt, userPrompt);
    } catch (e) {
      if (!(e instanceof ProviderUnavailableError) || !keys.claude) throw e;
      console.warn(`Gemini unavailable, falling back to Claude: ${e.message}`);
    }
  }
  if (keys.claude) return callClaude(keys.claude.apiKey, keys.claude.model, systemPrompt, userPrompt);
  throw new Error("No AI key saved. Run /setup.");
}
