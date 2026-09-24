import type { Env } from "../index";

// Data model, unchanged from the previous KV layout — only the backend changed.
//   user:{discordUserId}                -> UserConfig
//   repo:{owner}/{repo}                 -> RepoConfig
//   installation:{installationId}       -> discordUserId (string)
//   pr:{owner}/{repo}/{number}          -> PRReviewState

export type UserConfig = {
  discordUserId: string;
  guildId?: string;
  githubInstallationId?: number;
  anthropicKeyCipher?: string;
  enabled: boolean;
  autoMerge: boolean;
  mergeStrategy: "squash" | "merge" | "rebase";
  createdAt: string;
  updatedAt: string;
};

export type RepoConfig = {
  owner: string;
  repo: string;
  discordUserId: string;
  installationId: number;
  addedAt: string;
};

export type PRReviewState = {
  lastCommitSha: string;
  lastCiConclusion?: string;
  lastReviewAt?: string;
  status: "queued" | "reviewed" | "merged" | "commented" | "skipped";
  message?: string;
  cachedVerdict?: "approve" | "request_changes" | "comment";
  cachedAddressesIssue?: boolean;
  cachedCommentPosted?: boolean;
};

const userKey = (id: string) => `user:${id}`;
const repoKey = (owner: string, repo: string) => `repo:${owner.toLowerCase()}/${repo.toLowerCase()}`;
const installKey = (id: number) => `installation:${id}`;
const prKey = (owner: string, repo: string, n: number) =>
  `pr:${owner.toLowerCase()}/${repo.toLowerCase()}/${n}`;

// ---- primitive storage layer (SQLite via D1) --------------------------------

async function kvGet(env: Env, key: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "SELECT value FROM kv WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)",
  )
    .bind(key, now)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function kvPut(env: Env, key: string, value: string, ttlSeconds?: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = ttlSeconds ? now + ttlSeconds : null;
  await env.DB.prepare(
    "INSERT INTO kv (key, value, updated_at, expires_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, expires_at = excluded.expires_at",
  )
    .bind(key, value, now, expiresAt)
    .run();
}

async function kvDelete(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(key).run();
}

async function kvListWithPrefix(env: Env, prefix: string): Promise<{ key: string; value: string }[]> {
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM kv WHERE key LIKE ? AND (expires_at IS NULL OR expires_at > ?)",
  )
    .bind(`${prefix}%`, now)
    .all<{ key: string; value: string }>();
  return results ?? [];
}

// ---- typed public API (unchanged surface) -----------------------------------

export async function getUser(env: Env, discordUserId: string): Promise<UserConfig | null> {
  const raw = await kvGet(env, userKey(discordUserId));
  return raw ? (JSON.parse(raw) as UserConfig) : null;
}

export async function putUser(env: Env, cfg: UserConfig): Promise<void> {
  await kvPut(env, userKey(cfg.discordUserId), JSON.stringify(cfg));
}

export async function upsertUser(
  env: Env,
  discordUserId: string,
  patch: Partial<UserConfig>,
): Promise<UserConfig> {
  const existing = (await getUser(env, discordUserId)) ?? {
    discordUserId,
    enabled: true,
    autoMerge: true,
    mergeStrategy: "squash" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const next: UserConfig = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await putUser(env, next);
  return next;
}

export async function getRepo(env: Env, owner: string, repo: string): Promise<RepoConfig | null> {
  const raw = await kvGet(env, repoKey(owner, repo));
  return raw ? (JSON.parse(raw) as RepoConfig) : null;
}

export async function putRepo(env: Env, cfg: RepoConfig): Promise<void> {
  await kvPut(env, repoKey(cfg.owner, cfg.repo), JSON.stringify(cfg));
}

export async function deleteRepo(env: Env, owner: string, repo: string): Promise<void> {
  await kvDelete(env, repoKey(owner, repo));
}

export async function listReposFor(env: Env, discordUserId: string): Promise<RepoConfig[]> {
  const rows = await kvListWithPrefix(env, "repo:");
  const out: RepoConfig[] = [];
  for (const row of rows) {
    const cfg = JSON.parse(row.value) as RepoConfig;
    if (cfg.discordUserId === discordUserId) out.push(cfg);
  }
  return out;
}

export async function setInstallation(env: Env, installationId: number, discordUserId: string) {
  await kvPut(env, installKey(installationId), discordUserId);
}

export async function getInstallationOwner(env: Env, installationId: number): Promise<string | null> {
  return kvGet(env, installKey(installationId));
}

export async function getPRState(env: Env, owner: string, repo: string, n: number) {
  const raw = await kvGet(env, prKey(owner, repo, n));
  return raw ? (JSON.parse(raw) as PRReviewState) : null;
}

// Fields the state-equality check compares. `lastReviewAt` is deliberately
// excluded — it changes on every call and would defeat the write dedupe.
const STATE_MEANINGFUL_FIELDS: (keyof PRReviewState)[] = [
  "lastCommitSha",
  "lastCiConclusion",
  "status",
  "message",
  "cachedVerdict",
  "cachedAddressesIssue",
  "cachedCommentPosted",
];

function statesEqual(a: PRReviewState | null | undefined, b: PRReviewState): boolean {
  if (!a) return false;
  for (const k of STATE_MEANINGFUL_FIELDS) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export async function putPRState(
  env: Env,
  owner: string,
  repo: string,
  n: number,
  s: PRReviewState,
  prev?: PRReviewState | null,
) {
  if (statesEqual(prev, s)) return;
  await kvPut(env, prKey(owner, repo, n), JSON.stringify(s), 60 * 60 * 24 * 30);
}
