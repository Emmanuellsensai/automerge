import type { Env } from "../index";

// Data model, unchanged from the previous KV layout — only the backend changed.
//   user:{discordUserId}                -> UserConfig
//   repo:{owner}/{repo}                 -> RepoConfig
//   installation:{installationId}       -> discordUserId (string)
//   pr:{owner}/{repo}/{number}          -> PRReviewState
//   claim_channel:{guildId}             -> WatchConfig
//   contributor:{discordUserId}         -> ContributorLink
//   oauth_state:{state}                 -> discordUserId (short TTL)
//   last_msg:{channelId}                -> last Discord message id processed
//   claimed:{owner}/{repo}/{issueN}     -> ClaimRecord

export type UserConfig = {
  discordUserId: string;
  guildId?: string;
  githubInstallationId?: number;
  geminiKeyCipher?: string;
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
  status: "queued" | "reviewed" | "merged" | "commented" | "skipped" | "blocked";
  message?: string;
  cachedVerdict?: "approve" | "request_changes" | "comment";
  cachedForIssue?: number;
  cachedReview?: string;
  cachedAddressesIssue?: boolean;
  cachedCommentPosted?: boolean;
};

const userKey = (id: string) => `user:${id}`;
const repoKey = (owner: string, repo: string) => `repo:${owner.toLowerCase()}/${repo.toLowerCase()}`;
const installKey = (id: number) => `installation:${id}`;
const prKey = (owner: string, repo: string, n: number) =>
  `pr:${owner.toLowerCase()}/${repo.toLowerCase()}/${n}`;
const watchKey = (guildId: string) => `claim_channel:${guildId}`;
const contributorKey = (discordUserId: string) => `contributor:${discordUserId}`;
const oauthStateKey = (state: string) => `oauth_state:${state}`;
const lastMsgKey = (channelId: string) => `last_msg:${channelId}`;
const claimKey = (owner: string, repo: string, issueN: number) =>
  `claimed:${owner.toLowerCase()}/${repo.toLowerCase()}/${issueN}`;

export type WatchConfig = {
  guildId: string;
  channelId: string;
  owner: string;
  repo: string;
  installationId: number;
  discordUserId: string;
  addedAt: string;
};

export type ContributorLink = {
  discordUserId: string;
  githubLogin: string;
  verifiedAt: string;
};

export type ClaimRecord = {
  discordUserId?: string;
  githubLogin: string;
  at: string;
  status: "claimed" | "already_taken" | "unlinked";
  messageId?: string;
};

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
    autoMerge: false,
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
  "cachedForIssue",
  "cachedReview",
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

// ---- claim-flow helpers -----------------------------------------------------

export async function getWatch(env: Env, guildId: string): Promise<WatchConfig | null> {
  const raw = await kvGet(env, watchKey(guildId));
  return raw ? (JSON.parse(raw) as WatchConfig) : null;
}

export async function putWatch(env: Env, cfg: WatchConfig): Promise<void> {
  await kvPut(env, watchKey(cfg.guildId), JSON.stringify(cfg));
}

export async function listWatches(env: Env): Promise<WatchConfig[]> {
  const rows = await kvListWithPrefix(env, "claim_channel:");
  return rows.map((r) => JSON.parse(r.value) as WatchConfig);
}

export async function getContributor(
  env: Env,
  discordUserId: string,
): Promise<ContributorLink | null> {
  const raw = await kvGet(env, contributorKey(discordUserId));
  return raw ? (JSON.parse(raw) as ContributorLink) : null;
}

export async function putContributor(env: Env, link: ContributorLink): Promise<void> {
  await kvPut(env, contributorKey(link.discordUserId), JSON.stringify(link));
}

export async function putOAuthState(
  env: Env,
  state: string,
  discordUserId: string,
): Promise<void> {
  // 10-minute TTL is plenty for a user to bounce through GitHub's consent screen.
  await kvPut(env, oauthStateKey(state), discordUserId, 60 * 10);
}

export async function consumeOAuthState(env: Env, state: string): Promise<string | null> {
  const raw = await kvGet(env, oauthStateKey(state));
  if (raw) await kvDelete(env, oauthStateKey(state));
  return raw;
}

export async function getLastMsg(env: Env, channelId: string): Promise<string | null> {
  return kvGet(env, lastMsgKey(channelId));
}

export async function putLastMsg(env: Env, channelId: string, messageId: string): Promise<void> {
  await kvPut(env, lastMsgKey(channelId), messageId);
}

export async function getClaim(
  env: Env,
  owner: string,
  repo: string,
  issueN: number,
): Promise<ClaimRecord | null> {
  const raw = await kvGet(env, claimKey(owner, repo, issueN));
  return raw ? (JSON.parse(raw) as ClaimRecord) : null;
}

export async function putClaim(
  env: Env,
  owner: string,
  repo: string,
  issueN: number,
  record: ClaimRecord,
): Promise<void> {
  // 90-day TTL. Long enough that a re-scan won't re-claim, short enough not to grow forever.
  await kvPut(env, claimKey(owner, repo, issueN), JSON.stringify(record), 60 * 60 * 24 * 90);
}
