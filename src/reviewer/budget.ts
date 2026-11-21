// Time budget for one Worker run. No imports, so it can be tested directly.
//
// Cloudflare stops a Worker's background work about 30 seconds after the webhook response is
// sent (waitUntil), and cron runs on a schedule shorter than an hour get the same 30 seconds.
// A slow AI call used to run past that limit, so the run was killed before it could post a
// comment: the PR got no reply at all. Every AI call now gets a timeout that leaves time to
// post the comment and save the PR's state, whatever the provider does.

export const RUN_BUDGET_MS = 27_000;
// Kept back after the AI call for the PR comment, the state write and a possible merge.
export const REPLY_RESERVE_MS = 4_000;
// An AI review shorter than this is not worth starting; the next sweep retries instead.
export const MIN_CALL_MS = 8_000;
// Do not start reviewing another PR in the same run with less than this left.
export const MIN_PR_MS = 12_000;

export const GEMINI_MAX_MS = 25_000;
export const CLAUDE_MAX_MS = 40_000;

export function deadlineFrom(startMs: number, budgetMs = RUN_BUDGET_MS): number {
  return startMs + budgetMs;
}

// Timeout to give one AI call, or 0 when there isn't enough time left to start it.
export function callTimeoutMs(deadlineAt: number, nowMs: number, maxMs: number): number {
  const left = deadlineAt - nowMs - REPLY_RESERVE_MS;
  return left >= MIN_CALL_MS ? Math.min(maxMs, left) : 0;
}

export function hasTimeForAnotherPR(deadlineAt: number, nowMs: number): boolean {
  return deadlineAt - nowMs >= MIN_PR_MS;
}

export type AiAttemptState = { lastCommitSha: string; aiAttempts?: number; aiLastProvider?: string };

// How many AI attempts have failed on this commit so far, counting the one that just failed.
export function nextAttemptCount(prev: AiAttemptState | null | undefined, headSha: string): number {
  return prev && prev.lastCommitSha === headSha ? (prev.aiAttempts ?? 0) + 1 : 1;
}

// After Gemini failed or timed out on this commit, try Claude first next time so a slow
// Gemini can't use up every run's time before the backup gets a turn.
export function claudeFirst(prev: AiAttemptState | null | undefined, headSha: string): boolean {
  return !!prev && prev.lastCommitSha === headSha && (prev.aiAttempts ?? 0) > 0 && prev.aiLastProvider === "gemini";
}
