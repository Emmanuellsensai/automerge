// Which open PRs the background sweep should pick. No imports, so it can be tested directly.

// Stored inside a repo's sweep log (next to the per-PR "last swept" times): when a maintainer
// asked for a full re-check with /check on the whole repo. Every PR reviewed before this
// moment becomes due again, and the sweep works through them in its normal small batches.
export const FORCE_KEY = "_force";

// Never pick the same PR again within this window, so failures back off instead of looping.
export const MIN_GAP_SECONDS = 15 * 60;
// PRs already reviewed on their current commit are re-checked this rarely (gates like
// issue assignment can change without a new push). Unchanged PRs never re-call the AI.
export const RECHECK_SECONDS = 6 * 60 * 60;

export type DueState = { lastCommitSha: string; status: string; lastReviewAt?: string };

export function isDue(headSha: string, state: DueState | undefined, now: number, forcedAt = 0): boolean {
  if (!state) return true;
  if (state.lastCommitSha !== headSha) return true;
  if (state.status === "merged") return false;
  if (state.status === "queued") return true;
  const last = state.lastReviewAt ? Date.parse(state.lastReviewAt) / 1000 : 0;
  if (forcedAt > 0 && last < forcedAt) return true;
  return now - last > RECHECK_SECONDS;
}

// The back-off gap does not apply to a PR last swept before a full re-check was asked for.
export function recentlySwept(lastSwept: number, now: number, forcedAt = 0): boolean {
  if (forcedAt > 0 && lastSwept < forcedAt) return false;
  return now - lastSwept < MIN_GAP_SECONDS;
}
