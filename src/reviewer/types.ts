export type ReviewProblem = {
  severity: "blocking" | "suggestion";
  file: string;
  line: number;
  problem: string;
  fix: string;
};

export type ReviewJSON = {
  verdict: "approve" | "request_changes";
  addresses_issue: boolean;
  summary: string;
  missing_requirements: string[];
  problems: ReviewProblem[];
  // Set by us, not the model: which provider produced the review.
  provider?: "gemini" | "claude";
};

// Thrown when a provider can't serve right now (rate limit, quota, overload, timeout),
// which is the signal to try the fallback provider.
export class ProviderUnavailableError extends Error {
  constructor(public provider: string, message: string) {
    super(message);
  }
}

export function normalizeReview(parsed: ReviewJSON): ReviewJSON {
  parsed.problems = Array.isArray(parsed.problems) ? parsed.problems : [];
  parsed.missing_requirements = Array.isArray(parsed.missing_requirements) ? parsed.missing_requirements : [];
  // Never trust an approve that still lists blocking work.
  if (
    parsed.verdict === "approve" &&
    (parsed.problems.some((p) => p.severity === "blocking") || parsed.missing_requirements.length > 0)
  ) {
    parsed.verdict = "request_changes";
  }
  return parsed;
}
