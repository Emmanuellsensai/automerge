// Gemini generateContent client for the PR reviewer.
// Direct fetch (no SDK) to stay lean inside a Cloudflare Worker.

import { geminiShouldFallBack } from "./fallback";
import { normalizeReview, ProviderUnavailableError, type ReviewJSON } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

// Structured output schema (OpenAPI subset accepted by Gemini's responseSchema).
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["approve", "request_changes"] },
    addresses_issue: { type: "BOOLEAN" },
    summary: { type: "STRING" },
    missing_requirements: { type: "ARRAY", items: { type: "STRING" } },
    problems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          severity: { type: "STRING", enum: ["blocking", "suggestion"] },
          file: { type: "STRING" },
          line: { type: "INTEGER" },
          problem: { type: "STRING" },
          fix: { type: "STRING" },
        },
        required: ["severity", "file", "line", "problem", "fix"],
      },
    },
  },
  required: ["verdict", "addresses_issue", "summary", "missing_requirements", "problems"],
};

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1]! : text.trim();
}

export async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  // Set by runReview so the call ends in time for the Worker to post its comment.
  timeoutMs = 25_000,
): Promise<ReviewJSON> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          // Thinking models spend part of this budget on reasoning, so leave headroom.
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new ProviderUnavailableError("gemini", "Gemini timed out");
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text();
    let detail = body.slice(0, 300);
    try {
      // Google puts the useful part (which quota, which limit) in error.message.
      const m = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
      if (m) detail = m.replace(/\s+/g, " ").slice(0, 1000);
    } catch {}
    const msg = `Gemini ${res.status}: ${detail}`;
    // Key, billing, quota, retired-model and overload errors all mean "use the backup".
    if (geminiShouldFallBack(res.status)) throw new ProviderUnavailableError("gemini", msg);
    throw new Error(msg);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new ProviderUnavailableError("gemini", `Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  if (!text) throw new ProviderUnavailableError("gemini", `Gemini returned no text (finishReason=${cand?.finishReason ?? "unknown"})`);

  let parsed: ReviewJSON;
  try {
    parsed = JSON.parse(text) as ReviewJSON;
  } catch {
    // Only fall back to fence-stripping when the raw text isn't JSON: fixes often contain code fences.
    try {
      parsed = JSON.parse(extractJSON(text)) as ReviewJSON;
    } catch {
      throw new ProviderUnavailableError("gemini", `Gemini returned non-JSON response: ${text.slice(0, 300)}`);
    }
  }
  return { ...normalizeReview(parsed), provider: "gemini" };
}
