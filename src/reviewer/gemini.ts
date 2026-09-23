// Minimal Gemini REST client. Uses the v1beta generateContent endpoint.
// The maintainer's key is passed per request; we never store the plaintext.

export type GeminiReviewJSON = {
  verdict: "approve" | "request_changes" | "comment";
  addresses_issue: boolean;
  ci_ok: boolean;
  summary: string;
  issues: string[];
  suggested_comment: string;
};

const MODEL = "gemini-2.5-flash";

export async function callGemini(apiKey: string, prompt: string): Promise<GeminiReviewJSON> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        response_mime_type: "application/json",
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(text) as GeminiReviewJSON;
}
