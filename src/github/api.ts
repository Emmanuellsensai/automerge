import { statusChanged } from "./headline";
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
  author_association?: string;
  labels?: { name: string }[];
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
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
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
): Promise<{
  state: string;
  total_count: number;
  statuses: { context: string; state: string; target_url?: string | null; description?: string | null }[];
}> {
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
): Promise<{
  total_count: number;
  check_runs: {
    id: number;
    started_at?: string | null;
    conclusion: string | null;
    status: string;
    name: string;
    html_url?: string | null;
    details_url?: string | null;
    output?: { title?: string | null; summary?: string | null } | null;
  }[];
}> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`);
  if (!r.ok) throw new Error(`getCheckRuns: ${r.status}`);
  return r.json();
}

// Annotations are the per-line errors a check attached (lint findings, failed assertions, etc.).
// They are the most specific thing we can show a contributor without downloading raw logs.
export async function getCheckRunAnnotations(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  checkRunId: number,
): Promise<{ path: string; start_line: number | null; annotation_level: string | null; message: string | null; title: string | null }[]> {
  const r = await ghFetch(
    env,
    installationId,
    `/repos/${owner}/${repo}/check-runs/${checkRunId}/annotations?per_page=20`,
  );
  if (!r.ok) return [];
  return r.json();
}

export async function getIssue(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
): Promise<{
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  assignees: { login: string }[];
  state: string;
}> {
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

// Post a new comment or edit the existing one that carries `marker`.
// The marker is an HTML comment invisible to human readers — same trick Wayfare's workflow uses.
export async function upsertMarkedComment(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
  marker: string,
  body: string,
  // Post a fresh comment (and delete the old one) when the status headline changes, so the
  // author gets a notification. Edits notify nobody.
  repostOnStatusChange = false,
): Promise<void> {
  const listRes = await ghFetch(
    env,
    installationId,
    `/repos/${owner}/${repo}/issues/${n}/comments?per_page=100`,
  );
  if (listRes.ok) {
    const comments = (await listRes.json()) as { id: number; body: string }[];
    const existing = comments.find((c) => (c.body ?? "").includes(marker));
    const finalBody = body.includes(marker) ? body : `${body}\n\n${marker}`;
    if (existing) {
      if (existing.body === finalBody) return;
      if (repostOnStatusChange && statusChanged(existing.body, finalBody)) {
        await commentOnPR(env, installationId, owner, repo, n, finalBody);
        const d = await ghFetch(env, installationId, `/repos/${owner}/${repo}/issues/comments/${existing.id}`, { method: "DELETE" });
        if (!d.ok && d.status !== 404) console.warn(`upsertMarkedComment (delete old): ${d.status}`);
        return;
      }
      const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: finalBody }),
      });
      if (!r.ok) throw new Error(`upsertMarkedComment (edit): ${r.status} ${await r.text()}`);
      return;
    }
  }
  await commentOnPR(env, installationId, owner, repo, n, body.includes(marker) ? body : `${body}\n\n${marker}`);
}

// A file changed in a PR, with the fields the malware gate reads. `patch` is absent for
// binary files and for diffs GitHub considers too large; the gate treats that as "hold".
export type PRFile = {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
  previous_filename?: string;
};

// List the files changed in a PR (paginated up to 300 files). `complete` is false when a page
// failed or the 300 file cap was hit, so a caller that must not miss a file can fail closed.
export async function listPRFilesChecked(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
): Promise<{ files: PRFile[]; complete: boolean }> {
  const files: PRFile[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await ghFetch(
      env,
      installationId,
      `/repos/${owner}/${repo}/pulls/${n}/files?per_page=100&page=${page}`,
    );
    if (!r.ok) return { files, complete: false };
    const batch = (await r.json()) as PRFile[];
    files.push(...batch);
    if (batch.length < 100) return { files, complete: true };
  }
  return { files, complete: false };
}

export async function listPRFiles(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
): Promise<PRFile[]> {
  return (await listPRFilesChecked(env, installationId, owner, repo, n)).files;
}

// Best effort: remove a label from a PR. Never throws; 404 (label not on the PR) is fine.
export async function unlabelPR(env: Env, installationId: number, owner: string, repo: string, n: number, label: string): Promise<void> {
  try {
    const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/issues/${n}/labels/${encodeURIComponent(label)}`, {
      method: "DELETE",
    });
    if (!r.ok && r.status !== 404) console.warn(`unlabelPR: ${r.status}`);
  } catch (e) {
    console.warn(`unlabelPR failed on ${owner}/${repo}#${n}`, e);
  }
}

// Best effort: label a PR so a maintainer can find it. Never throws; the hold does not depend on it.
export async function labelPR(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  n: number,
  label: string,
  color = "d93f0b",
  description = "Held by the malware gate; a maintainer must read the diff",
): Promise<void> {
  try {
    await ghFetch(env, installationId, `/repos/${owner}/${repo}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: label, color, description }),
    }); // 422 when it already exists; ignored
    const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/issues/${n}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels: [label] }),
    });
    if (!r.ok) console.warn(`labelPR: ${r.status}`);
  } catch (e) {
    console.warn("labelPR failed", e);
  }
}

// Best effort: publish a commit status so branch protection can require it and block a manual
// merge too. Needs the GitHub App's "Commit statuses: write" permission; without it this logs
// a warning and nothing else happens.
export async function setCommitStatus(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  sha: string,
  state: "success" | "failure",
  description: string,
  context = "malware-gate",
): Promise<void> {
  try {
    const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/statuses/${sha}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, context, description: description.slice(0, 140) }),
    });
    if (!r.ok) console.warn(`setCommitStatus: ${r.status}`);
  } catch (e) {
    console.warn("setCommitStatus failed", e);
  }
}

export async function listWorkflowRunsAwaitingApproval(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  headSha: string,
): Promise<{ id: number; status: string }[]> {
  const r = await ghFetch(
    env,
    installationId,
    `/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=30`,
  );
  if (!r.ok) return [];
  const data = (await r.json()) as { workflow_runs?: { id: number; status: string }[] };
  return (data.workflow_runs ?? []).filter((run) =>
    ["action_required", "waiting"].includes(run.status),
  );
}

export async function approveWorkflowRun(
  env: Env,
  installationId: number,
  owner: string,
  repo: string,
  runId: number,
): Promise<void> {
  const r = await ghFetch(env, installationId, `/repos/${owner}/${repo}/actions/runs/${runId}/approve`, {
    method: "POST",
  });
  if (!r.ok && r.status !== 404) {
    // 404 means run isn't awaiting approval anymore; harmless.
    throw new Error(`approveWorkflowRun: ${r.status} ${await r.text()}`);
  }
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
