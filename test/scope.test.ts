// Run with Node 22.18+:  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { extractIssueScopePaths, outOfScopeFiles } from "../src/reviewer/scope.ts";

const f = (filename: string) => ({ filename, status: "modified" });
const outside = (files: string[], scope: string[]) => outOfScopeFiles(files.map(f), scope).map((x) => x.filename);

test("a path the issue names relative to a package matches the full path (sorolens #900)", () => {
  const scope = extractIssueScopePaths("Touch `middleware/ratelimit.go`, `api/index.go`, `main.go` and `docs/openapi.yaml`.");
  assert.deepEqual(
    outside(["apps/api/internal/middleware/ratelimit.go", "apps/api/api/index.go", "apps/api/main.go", "apps/api/internal/config/config.go"], scope),
    ["apps/api/internal/config/config.go"],
  );
});

test("exact paths, extensionless names and folders still match", () => {
  assert.deepEqual(outside(["cli/cmd/watchdog.go", "cli/cmd/root.go", "pkg/x/y.ts", "other.ts"], ["cli/cmd/watchdog", "pkg/x"]), [
    "cli/cmd/root.go",
    "other.ts",
  ]);
  assert.deepEqual(outside(["apps/cli/cmd/root.go"], ["cli/cmd"]), []);
});

test("only whole path segments match", () => {
  assert.deepEqual(outside(["apps/api/internal/xmiddleware/ratelimit.go", "apps/api/notmain.go"], ["middleware/ratelimit.go", "main.go"]), [
    "apps/api/internal/xmiddleware/ratelimit.go",
    "apps/api/notmain.go",
  ]);
});

test("tests and docs are always allowed", () => {
  assert.deepEqual(outside(["apps/api/x_test.go", "web/a.test.ts", "docs/guide.txt", "README.md"], ["main.go"]), []);
});
