// Run with Node 22.18+:  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { commentHeadline, statusChanged } from "../src/github/headline.ts";

const body = (h: string, rest = "details") => `### ${h}\n\n@someone ${rest}\n\n<!-- automerge-gate -->`;

test("reads the status headline", () => {
  assert.equal(commentHeadline(body("AutoMerge: held for maintainer review")), "AutoMerge: held for maintainer review");
  assert.equal(commentHeadline("<!-- automerge-gate -->\nold format"), "");
});

test("a new status is a change; new details under the same status are not", () => {
  assert.equal(statusChanged(body("AutoMerge: held for maintainer review"), body("AutoMerge: approved and merged")), true);
  assert.equal(statusChanged(body("AutoMerge: code looks good, waiting for CI", "a"), body("AutoMerge: code looks good, waiting for CI", "b")), false);
});

test("replacing an old-format comment counts as a change", () => {
  assert.equal(statusChanged("<!-- automerge-gate -->\nAutoMerge: this PR won't auto-merge", body("AutoMerge: fix the steps below")), true);
});
