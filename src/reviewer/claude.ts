// Anthropic Messages API client for the PR reviewer.
// Uses direct fetch (not the SDK) to stay lean inside a Cloudflare Worker.

export type ReviewJSON = {
  verdict: "approve" | "request_changes" | "comment";
  addresses_issue: boolean;
  ci_ok: boolean;
  summary: string;
  issues: string[];
  suggested_comment: string;
};

const MODEL = "claude-haiku-4-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const PER_CALL_TIMEOUT_MS = 25_000;

function extractJSON(text: string): string {
  // Model sometimes wraps JSON in ```json ... ``` fences; strip them.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) return fenced[1]!;
  return text.trim();
}

export async function callClaude(apiKey: string, systemPrompt: string, userPrompt: string): Promise<ReviewJSON> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  if (!text) throw new Error("Claude returned no text content");

  try {
    return JSON.parse(extractJSON(text)) as ReviewJSON;
  } catch (e) {
    throw new Error(`Claude returned non-JSON response: ${text.slice(0, 300)}`);
  }
}
