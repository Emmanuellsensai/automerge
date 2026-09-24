import type { Env } from "../index";
import { installationToken } from "../github/app";

const UA = "automerge-bot";

export type IssueSnapshot = {
  number: number;
  state: string;
  assignees: string[];
};

export async function getIssueForClaim(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
): Promise<IssueSnapshot | null> {
  const token = await installationToken(env, installationId);
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${n}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`getIssue: ${r.status}`);
  const data = (await r.json()) as {
    number: number;
    state: string;
    pull_request?: unknown;
    assignees?: { login: string }[];
  };
  // GitHub returns PRs from the issues endpoint too. Reject them.
  if (data.pull_request) return null;
  return {
    number: data.number,
    state: data.state,
    assignees: (data.assignees ?? []).map((a) => a.login),
  };
}

export async function assignIssue(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
  login: string,
): Promise<boolean> {
  const token = await installationToken(env, installationId);
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${n}/assignees`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": UA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assignees: [login] }),
    },
  );
  if (!r.ok) {
    // 422 usually means the login isn't a valid assignee for this repo
    // (not a collaborator, not enough repo access). Treat as failure but
    // don't blow up the poll.
    console.error(`assignIssue ${owner}/${repo}#${n} -> ${login}: ${r.status} ${await r.text()}`);
    return false;
  }
  const data = (await r.json()) as { assignees?: { login: string }[] };
  return (data.assignees ?? []).some((a) => a.login.toLowerCase() === login.toLowerCase());
}
