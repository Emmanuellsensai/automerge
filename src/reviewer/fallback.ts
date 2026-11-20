// Gemini HTTP statuses that mean "this provider can't serve right now, use the backup":
// 401/403 = bad key or billing problem (e.g. "billing account has an outstanding balance"),
// 402 = payment required, 404 = model retired or not offered to this key,
// 429 = rate limit or quota exhausted, 500/503 = Google-side overload.
const GEMINI_FALLBACK_STATUSES = new Set([401, 402, 403, 404, 429, 500, 503]);

export function geminiShouldFallBack(status: number): boolean {
  return GEMINI_FALLBACK_STATUSES.has(status);
}
