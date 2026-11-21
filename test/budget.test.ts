// Run with Node 22.18+:  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_MAX_MS,
  GEMINI_MAX_MS,
  MIN_CALL_MS,
  REPLY_RESERVE_MS,
  RUN_BUDGET_MS,
  callTimeoutMs,
  claudeFirst,
  deadlineFrom,
  hasTimeForAnotherPR,
  nextAttemptCount,
} from "../src/reviewer/budget.ts";

test("the run budget stays under Cloudflare's 30s background limit, with room to reply", () => {
  assert.ok(RUN_BUDGET_MS <= 28_000);
  const start = 1_000_000;
  const deadline = deadlineFrom(start);
  // Even the longest call finishes REPLY_RESERVE_MS before the deadline.
  const t = callTimeoutMs(deadline, start, CLAUDE_MAX_MS);
  assert.equal(t, RUN_BUDGET_MS - REPLY_RESERVE_MS);
  assert.ok(start + t + REPLY_RESERVE_MS <= deadline);
});

test("a call gets its own cap when there is plenty of time", () => {
  assert.equal(callTimeoutMs(100_000, 0, GEMINI_MAX_MS), GEMINI_MAX_MS);
});

test("no call starts when less than the minimum is left", () => {
  const deadline = 50_000;
  const now = deadline - REPLY_RESERVE_MS - MIN_CALL_MS + 1;
  assert.equal(callTimeoutMs(deadline, now, GEMINI_MAX_MS), 0);
  assert.equal(callTimeoutMs(deadline, now - 1, GEMINI_MAX_MS), MIN_CALL_MS);
});

test("a second PR is only started with enough time left", () => {
  assert.equal(hasTimeForAnotherPR(30_000, 0), true);
  assert.equal(hasTimeForAnotherPR(30_000, 25_000), false);
});

test("failed attempts count up on the same commit and reset on a new one", () => {
  assert.equal(nextAttemptCount(null, "a"), 1);
  assert.equal(nextAttemptCount({ lastCommitSha: "a" }, "a"), 1);
  assert.equal(nextAttemptCount({ lastCommitSha: "a", aiAttempts: 2 }, "a"), 3);
  assert.equal(nextAttemptCount({ lastCommitSha: "a", aiAttempts: 2 }, "b"), 1);
});

test("after Gemini failed on this commit, the next attempt starts with Claude", () => {
  assert.equal(claudeFirst({ lastCommitSha: "a", aiAttempts: 1, aiLastProvider: "gemini" }, "a"), true);
  assert.equal(claudeFirst({ lastCommitSha: "a", aiAttempts: 1, aiLastProvider: "claude" }, "a"), false);
  assert.equal(claudeFirst({ lastCommitSha: "a", aiAttempts: 1, aiLastProvider: "gemini" }, "b"), false);
  assert.equal(claudeFirst(null, "a"), false);
});
