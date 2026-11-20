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

export function outOfScopeFiles(changed: ChangedFile[], scope: string[]): ChangedFile[] {
  if (scope.length === 0) return [];
  return changed.filter((f) => {
    if (/(_test\.(go|py|ts|tsx|js|jsx|rs))$|(\.test\.(ts|tsx|js|jsx))$|\.spec\.(ts|tsx|js|jsx)$/.test(f.filename)) return false;
    if (/^docs?\//i.test(f.filename) || /\.md$/i.test(f.filename)) return false;
    return !scope.some((p) => inScope(f.filename, p));
  });
}
