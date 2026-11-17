// Accepts "owner/repo", "github.com/owner/repo", or any full GitHub URL
// (including links to an issue or PR inside the repo).
export function parseRepo(input?: string): { owner: string; repo: string } | null {
  if (!input) return null;
  const s = input.trim().replace(/^<|>$/g, "");
  const url = s.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (url) return { owner: url[1]!, repo: url[2]!.replace(/\.git$/i, "") };
  const slug = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return slug ? { owner: slug[1]!, repo: slug[2]!.replace(/\.git$/i, "") } : null;
}

export const REPO_HINT =
  "Paste the repo's GitHub link (for example `https://github.com/sorolens/sorolens`) or type `owner/repo`.";
