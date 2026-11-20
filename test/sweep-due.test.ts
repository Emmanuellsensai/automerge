// Run with Node 22.18+:  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { isDue, recentlySwept, MIN_GAP_SECONDS, RECHECK_SECONDS } from "../src/reviewer/sweep-due.ts";

const now = 1_800_000_000;
const at = (secAgo: number) => new Date((now - secAgo) * 1000).toISOString();
const state = (secAgo: number, status = "blocked", sha = "abc") => ({ lastCommitSha: sha, status, lastReviewAt: at(secAgo) });

test("without a forced re-check, an unchanged PR waits for the 6-hour recheck", () => {
  assert.equal(isDue("abc", state(60), now), false);
  assert.equal(isDue("abc", state(RECHECK_SECONDS + 1), now), true);
  assert.equal(isDue("new", state(60), now), true);
  assert.equal(isDue("abc", undefined, now), true);
});

test("a forced re-check makes every PR reviewed before it due again", () => {
  const forcedAt = now - 30;
  assert.equal(isDue("abc", state(60), now, forcedAt), true);
  assert.equal(isDue("abc", state(10), now, forcedAt), false); // already re-checked after the request
  assert.equal(isDue("abc", state(60, "merged"), now, forcedAt), false);
});

test("the back-off gap is skipped only for PRs swept before the forced re-check", () => {
  assert.equal(recentlySwept(now - 60, now), true);
  assert.equal(recentlySwept(now - MIN_GAP_SECONDS - 1, now), false);
  assert.equal(recentlySwept(now - 60, now, now - 30), false);
  assert.equal(recentlySwept(now - 10, now, now - 30), true);
});
