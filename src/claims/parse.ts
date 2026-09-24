// Extract issue references from a raw Discord message body.
// A reference resolves to a (owner, repo, issueNumber) tuple. Bare `#N`
// matches inherit the watched repo passed in by the caller.

export type IssueRef = { owner: string; repo: string; number: number };

const URL_RE = /https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+)\/issues\/(\d+)/gi;
const BARE_RE = /(?:^|\s|[^\w#])#(\d{1,7})\b/g;

export function parseIssueRefs(
  body: string,
  fallback: { owner: string; repo: string },
): IssueRef[] {
  const out: IssueRef[] = [];
  const seen = new Set<string>();

  for (const m of body.matchAll(URL_RE)) {
    const owner = m[1]!.toLowerCase();
    const repo = m[2]!.toLowerCase();
    const number = Number(m[3]);
    if (!Number.isFinite(number) || number <= 0) continue;
    const key = `${owner}/${repo}/${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number });
  }

  for (const m of body.matchAll(BARE_RE)) {
    const number = Number(m[1]);
    if (!Number.isFinite(number) || number <= 0) continue;
    const owner = fallback.owner.toLowerCase();
    const repo = fallback.repo.toLowerCase();
    const key = `${owner}/${repo}/${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number });
  }

  return out;
}
