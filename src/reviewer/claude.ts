import Anthropic from "@anthropic-ai/sdk";
import { normalizeReview, ProviderUnavailableError, type ReviewJSON } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

// Structured-output schema: every object needs additionalProperties: false.
const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["approve", "request_changes"] },
    addresses_issue: { type: "boolean" },
    summary: { type: "string" },
    missing_requirements: { type: "array", items: { type: "string" } },
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["blocking", "suggestion"] },
          file: { type: "string" },
          line: { type: "integer" },
          problem: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "file", "line", "problem", "fix"],
      },
    },
  },
  required: ["verdict", "addresses_issue", "summary", "missing_requirements", "problems"],
};

export async function callClaude(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<ReviewJSON> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 40_000 });
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      output_config: { format: { type: "json_schema", schema: REVIEW_SCHEMA } },
    });
  } catch (e) {
    if (
      e instanceof Anthropic.RateLimitError ||
      e instanceof Anthropic.InternalServerError ||
      e instanceof Anthropic.APIConnectionError
    ) {
      throw new ProviderUnavailableError("claude", `Claude: ${(e as Error).message}`);
    }
    if (e instanceof Anthropic.APIError) throw new Error(`Claude ${e.status}: ${e.message}`);
    throw e;
  }

  if (response.stop_reason === "refusal") throw new Error("Claude declined to review this PR");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's review was cut off (max_tokens)");
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: ReviewJSON;
  try {
    parsed = JSON.parse(text) as ReviewJSON;
  } catch {
    throw new Error(`Claude returned non-JSON response: ${text.slice(0, 300)}`);
  }
  return { ...normalizeReview(parsed), provider: "claude" };
}

export async function validateAnthropicKey(apiKey: string, model: string): Promise<string | null> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 });
  try {
    await client.models.retrieve(model);
    return null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return "Anthropic says that key isn't valid. Copy it again from https://console.anthropic.com/settings/keys (it starts with `sk-ant-`) and run `/setup` again.";
    }
    if (e instanceof Anthropic.NotFoundError) return `The Anthropic key works but model \`${model}\` was not found for it.`;
    return `Could not verify the Anthropic key (${(e as Error).message.slice(0, 120)}).`;
  }
}
