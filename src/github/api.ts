import type { Env } from "../index";
import { installationToken } from "./app";

const UA = "automerge-bot";

async function ghFetch(env: Env, installationId: number, path: string, init: RequestInit = {}) {
  const token = await installationToken(env, installationId);
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
      ...(init.headers ?? {}),
    },
  });
}

export type PR = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  head: { sha: string; ref: string };
  base: { ref: string };
  user: { login: string } | null;
  html_url: string;
  mergeable: boolean | null;
  mergeable_state: string;
};

export async function getPR(env: Env, installationId: number, owner: string, repo: string, n: number): Promise<PR> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/pulls/${n}`);
  if (!r.ok) throw new Error(`getPR: ${r.status}`);
  return r.json();
}

export async function listOpenPRs(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
): Promise<PR[]> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/pulls?state=open&per_page=30`);
  if (!r.ok) throw new Error(`listOpenPRs: ${r.status}`);
  return r.json();
}

export async function getPRDiff(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
): Promise<string> {
  const token = await installationToken(env, installationId);
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${n}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3.diff",
      "User-Agent": UA,
    },
  });
  if (!r.ok) throw new Error(`getPRDiff: ${r.status}`);
  return r.text();
}

export async function getCombinedStatus(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ state: string; total_count: number }> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/commits/${sha}/status`);
  if (!r.ok) throw new Error(`getCombinedStatus: ${r.status}`);
  return r.json();
}

export async function getCheckRuns(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ total_count: number; check_runs: { conclusion: string | null; status: string; name: string }[] }> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/commits/${sha}/check-runs`);
  if (!r.ok) throw new Error(`getCheckRuns: ${r.status}`);
  return r.json();
}

export async function getIssue(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
): Promise<{ number: number; title: string; body: string | null; labels: { name: string }[] }> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/issues/${n}`);
  if (!r.ok) throw new Error(`getIssue: ${r.status}`);
  return r.json();
}

export async function commentOnPR(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
  body: string,
): Promise<void> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/issues/${n}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!r.ok) throw new Error(`commentOnPR: ${r.status} ${await r.text()}`);
}

export async function mergePR(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
  method: "squash" | "merge" | "rebase",
  sha?: string,
): Promise<void> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/pulls/${n}/merge`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merge_method: method, sha }),
  });
  if (!r.ok) throw new Error(`mergePR: ${r.status} ${await r.text()}`);
}
