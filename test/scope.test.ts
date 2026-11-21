// Run with Node 22.18+:  node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { allowsGeneratedClients, extractIssueScopePaths, outOfScopeFiles } from "../src/reviewer/scope.ts";

const f = (filename: string) => ({ filename, status: "modified" });
const outside = (files: string[], scope: string[], allowGeneratedClients = false) =>
  outOfScopeFiles(files.map(f), scope, { allowGeneratedClients }).map((x) => x.filename);

test("a path the issue names relative to a package matches the full path, and covers its component (sorolens #900)", () => {
  const scope = extractIssueScopePaths("Touch `middleware/ratelimit.go`, `api/index.go`, `main.go` and `docs/openapi.yaml`.");
  assert.deepEqual(
    outside(["apps/api/internal/middleware/ratelimit.go", "apps/api/api/index.go", "apps/api/main.go", "apps/api/internal/config/config.go"], scope),
    [],
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

// Real file lists from sorolens PRs that the old gate held as out of scope.
const SPEC_NOTE = "Anything that changes the API must update `docs/openapi.yaml` and the generated clients.";
const check = (issueBody: string, files: string[]) =>
  outside(files, extractIssueScopePaths(issueBody), allowsGeneratedClients([issueBody], files.map(f)));

test("sorolens #927 / #776: a named handler covers apps/api, generated clients follow the spec, hand-written web types go to the AI", () => {
  const issue = "`intQuery` in `handler/contracts.go` accepts any positive `limit`. " + SPEC_NOTE;
  assert.deepEqual(check(issue, [
    "apps/api/internal/handler/alerts.go",
    "apps/api/internal/handler/contracts.go",
    "apps/api/internal/handler/events_global.go",
    "apps/api/internal/handler/live.go",
    "apps/api/internal/handler/pagination_validation_test.go",
    "apps/api/internal/handler/stats.go",
    "apps/api/internal/handler/upgrades.go",
    "apps/api/internal/handler/v2.go",
    "apps/api/internal/handler/watchdog.go",
    "apps/api/internal/middleware/cache.go",
    "apps/api/internal/router/router.go",
    "apps/api/internal/store/mock.go",
    "apps/api/internal/store/models.go",
    "apps/api/internal/store/postgres.go",
    "apps/api/internal/store/query.go",
    "apps/web/lib/openapi.generated.ts",
    "apps/web/lib/types.ts",
    "docs/openapi.yaml",
    "packages/go-client/internal/client/client.gen.go",
    "packages/python-sdk/src/sorolens/_generated/models/get_global_stats_response_200.py",
    "packages/python-sdk/src/sorolens/_generated/models/v2_global_stats.py",
    "packages/rust-sdk/src/types.rs",
  ]), ["apps/web/lib/types.ts"]);
});

test("sorolens #877 / #776: the whole PR is in scope", () => {
  const issue = "`intQuery` in `handler/contracts.go` accepts any positive `limit`. " + SPEC_NOTE;
  assert.deepEqual(check(issue, [
    "apps/api/internal/handler/alerts.go",
    "apps/api/internal/handler/apikeys.go",
    "apps/api/internal/handler/audit.go",
    "apps/api/internal/handler/cache_route_test.go",
    "apps/api/internal/handler/contracts.go",
    "apps/api/internal/handler/errors.go",
    "apps/api/internal/handler/events_csv_export.go",
    "apps/api/internal/handler/events_global.go",
    "apps/api/internal/handler/params.go",
    "apps/api/internal/handler/query_params_test.go",
    "apps/api/internal/handler/stats.go",
    "apps/api/internal/handler/v2.go",
    "apps/api/internal/handler/watchdog.go",
    "apps/api/internal/handler/watchdog_pagination_test.go",
    "apps/api/internal/middleware/cache.go",
    "apps/api/internal/router/router.go",
    "apps/api/internal/store/models.go",
    "apps/api/internal/store/postgres.go",
    "apps/api/internal/store/store.go",
    "apps/web/lib/openapi.generated.ts",
    "docs/openapi.yaml",
    "packages/go-client/internal/client/client.gen.go",
    "packages/python-sdk/src/sorolens/_generated/api/stats/get_global_stats.py",
    "packages/python-sdk/src/sorolens/_generated/models/error_error_type_0.py",
    "packages/python-sdk/src/sorolens/_generated/models/get_global_stats_response_200.py",
    "packages/python-sdk/src/sorolens/_generated/models/v2_global_stats.py",
    "packages/python-sdk/tests/fixtures/global_stats.json",
  ]), []);
});

test("sorolens #893 / #802: API work in another app is left for the AI to judge, not auto-allowed", () => {
  const issue = "Detect SAC contracts (see `internal/discovery`). " + SPEC_NOTE;
  assert.deepEqual(check(issue, [
    "apps/api/internal/handler/contracts.go",
    "apps/api/internal/handler/labels.go",
    "apps/api/internal/store/contract_tags.go",
    "apps/web/lib/api.ts",
    "services/indexer/internal/discovery/discovery.go",
    "services/indexer/internal/discovery/discovery_test.go",
  ]), [
    "apps/api/internal/handler/contracts.go",
    "apps/api/internal/handler/labels.go",
    "apps/api/internal/store/contract_tags.go",
    "apps/web/lib/api.ts",
  ]);
});

test("sorolens #881 / #779: indexer internals are in scope; only the integration compose file is left for the AI", () => {
  // go.mod/go.sum fall inside services/indexer here, but the dependency gate in review.ts checks
  // every changed file on its own and still blocks them.
  const issue = "`stubRedis` in `services/indexer/main.go` is a no-op. Document in `docs/metrics.md`. " + SPEC_NOTE;
  assert.deepEqual(check(issue, [
    "docs/configuration.md",
    "docs/indexer.md",
    "docs/metrics.md",
    "services/indexer/go.mod",
    "services/indexer/go.sum",
    "services/indexer/internal/lock/lock.go",
    "services/indexer/internal/lock/lock_test.go",
    "services/indexer/internal/metrics/metrics.go",
    "services/indexer/internal/metrics/metrics_test.go",
    "services/indexer/internal/pgstore/pgstore.go",
    "services/indexer/internal/poller/interfaces.go",
    "services/indexer/internal/poller/poller.go",
    "services/indexer/internal/poller/poller_test.go",
    "services/indexer/main.go",
    "services/indexer/main_test.go",
    "tests/integration/docker-compose.yml",
  ]), [
    "tests/integration/docker-compose.yml",
  ]);
});

test("a change in an unrelated component is still reported", () => {
  assert.deepEqual(
    outside(["apps/api/internal/handler/a.go", "apps/api/internal/store/b.go", "apps/web/app/page.tsx", "services/indexer/x.go"], ["handler/a.go"]),
    ["apps/web/app/page.tsx", "services/indexer/x.go"],
  );
});

test("component widening only applies under monorepo roots, not to top-level folders", () => {
  assert.deepEqual(outside(["src/a.ts", "src/b.ts"], ["src/a.ts"]), ["src/b.ts"]);
});

test("generated clients are allowed only when the issue or PR touches the API spec", () => {
  const files = ["apps/api/h.go", "packages/go-client/client.gen.go", "apps/web/lib/openapi.generated.ts", "packages/python-sdk/src/x/_generated/m.py"];
  assert.deepEqual(outside(files, ["apps/api/h.go"], true), []);
  assert.deepEqual(outside(files, ["apps/api/h.go"], false), files.slice(1));
  assert.equal(allowsGeneratedClients(["Fix the button colour."], files.map(f)), false);
  assert.equal(allowsGeneratedClients(["Fix the button colour."], [f("docs/openapi.yaml")]), true);
  assert.equal(allowsGeneratedClients([SPEC_NOTE], []), true);
});

test("fixtures and testdata are allowed like tests", () => {
  assert.deepEqual(outside(["src/a.ts", "packages/sdk/tests/fixtures/x.json", "pkg/testdata/y.txt"], ["src/a.ts"]), []);
});
