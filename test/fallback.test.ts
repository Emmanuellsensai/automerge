// Run with Node 22.18+:  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { geminiShouldFallBack } from "../src/reviewer/fallback.ts";

test("Gemini billing and key errors fall back to Claude", () => {
  for (const s of [401, 402, 403]) assert.equal(geminiShouldFallBack(s), true, String(s));
});

test("Gemini rate limit, retired model and overload still fall back", () => {
  for (const s of [404, 429, 500, 503]) assert.equal(geminiShouldFallBack(s), true, String(s));
});

test("bad requests do not fall back (Claude would fail the same way)", () => {
  for (const s of [400, 413, 422]) assert.equal(geminiShouldFallBack(s), false, String(s));
});
