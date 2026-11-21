// Issue scope: which repository paths an issue names, and which changed files fall outside them.
// No imports, so it can be unit tested directly.

export type ChangedFile = { filename: string; status: string };

export function extractIssueScopePaths(issueBody: string | null): string[] {
  if (!issueBody) return [];
  const raw = issueBody.match(/`[a-zA-Z0-9_./\-]+`/g) ?? [];
  return Array.from(
    new Set(
      raw
        .map((t) => t.replace(/`/g, "").replace(/^\.\//, "").replace(/\/+$/, ""))
        // MIME types and URL routes contain "/" but are not repository paths.
        .filter((p) => !/^(text|application|image|audio|video|multipart|font|message)\/[\w.+-]+$/i.test(p))
        .filter((p) => !p.startsWith("/"))
        .filter((p) => /\//.test(p) || /\.(go|ts|tsx|js|jsx|py|rs|md|ya?ml|json|sql|toml|sh)$/i.test(p)),
    ),
  );
}

// Issues usually name a path relative to some package (`middleware/ratelimit.go` for
// `apps/api/internal/middleware/ratelimit.go`) and often leave off the extension
// (`cli/cmd/watchdog` for watchdog.go). A file is in scope when the named path matches whole
// path segments anywhere in it: the full path, a trailing part of it, or a folder it sits in.
function inScope(filename: string, scopePath: string): boolean {
  const noExt = filename.replace(/\.[^/.]+$/, "");
  return [filename, noExt].some(
    (c) => c === scopePath || c.endsWith("/" + scopePath) || c.startsWith(scopePath + "/") || c.includes("/" + scopePath + "/"),
  );
}

// Monorepo roots whose children are separate apps/services/packages. Issues name one or two
// files as pointers ("see `internal/discovery`"), not the full list, so a named path puts its
// whole component in scope: `handler/contracts.go` covers all of `apps/api`.
const COMPONENT_ROOTS = new Set(["apps", "services", "packages", "libs", "crates", "modules", "plugins"]);

export function componentOf(filename: string): string | null {
  const parts = filename.split("/");
  return parts.length >= 3 && COMPONENT_ROOTS.has(parts[0] ?? "") ? parts.slice(0, 2).join("/") : null;
}

// Files regenerated from the API spec. Issues require "update docs/openapi.yaml and the
// generated clients" whenever the API changes, so these follow the spec rather than the issue.
const GENERATED_CLIENT = [
  /(^|\/)openapi[^/]*\.(ya?ml|json)$/i,
  /\.generated\.[a-z]+$/i,
  /\.gen\.go$/i,
  /(^|\/)_?generated\//i,
  /^packages\/[^/]*(client|sdk)[^/]*\//i,
];
export const isGeneratedClient = (filename: string) => GENERATED_CLIENT.some((r) => r.test(filename));

// True when the issue asks for spec/client updates or the PR itself changes the API spec.
export function allowsGeneratedClients(issueBodies: (string | null)[], changed: ChangedFile[]): boolean {
  return (
    issueBodies.some((b) => !!b && /openapi|generated client|generated sdk/i.test(b)) ||
    changed.some((f) => /(^|\/)openapi[^/]*\.(ya?ml|json)$/i.test(f.filename))
  );
}

const isTestOrDoc = (filename: string) =>
  /(_test\.(go|py|ts|tsx|js|jsx|rs))$|(\.test\.(ts|tsx|js|jsx))$|\.spec\.(ts|tsx|js|jsx)$/.test(filename) ||
  /(^|\/)(__tests__|testdata|fixtures)\//i.test(filename) ||
  /^docs?\//i.test(filename) ||
  /\.md$/i.test(filename);

export type ScopeOptions = { allowGeneratedClients?: boolean };

// Files outside what the issue names. These are not a hard failure: the caller hands them to
// the AI review, which decides whether each one is needed for the issue or is unrelated.
export function outOfScopeFiles(changed: ChangedFile[], scope: string[], opts: ScopeOptions = {}): ChangedFile[] {
  if (scope.length === 0) return [];
  const named = (f: ChangedFile) => scope.some((p) => inScope(f.filename, p));
  const areas = new Set(changed.filter(named).map((f) => componentOf(f.filename)).filter((c): c is string => !!c));
  return changed.filter((f) => {
    if (isTestOrDoc(f.filename) || named(f)) return false;
    const c = componentOf(f.filename);
    if (c && areas.has(c)) return false;
    if (opts.allowGeneratedClients && isGeneratedClient(f.filename)) return false;
    return true;
  });
}
