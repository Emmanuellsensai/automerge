import type { Env } from "../index";

// User = the Discord user who ran /setup. They own the config and the linked GitHub App installation.
// Data model in KV:
//   user:{discordUserId}                -> UserConfig
//   repo:{owner}/{repo}                 -> RepoConfig (owner+repo -> discord user + installation)
//   installation:{installationId}       -> discordUserId
//   pr:{owner}/{repo}/{number}          -> per-PR review state (idempotency, last CI status)

export type UserConfig = {
  discordUserId: string;
  guildId?: string;
  githubInstallationId?: number;
  anthropicKeyCipher?: string; // AES-GCM encrypted
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
  // Cached Claude verdict for this SHA. Set once per SHA to avoid re-billing on later webhooks.
  cachedVerdict?: "approve" | "request_changes" | "comment";
  cachedAddressesIssue?: boolean;
  cachedCommentPosted?: boolean;
};

const userKey = (id: string) => `user:${id}`;
const repoKey = (owner: string, repo: string) => `repo:${owner.toLowerCase()}/${repo.toLowerCase()}`;
const installKey = (id: number) => `installation:${id}`;
const prKey = (owner: string, repo: string, n: number) =>
  `pr:${owner.toLowerCase()}/${repo.toLowerCase()}/${n}`;

export async function getUser(env: Env, discordUserId: string): Promise<UserConfig | null> {
  return env.AUTOMERGE.get<UserConfig>(userKey(discordUserId), "json");
}

export async function putUser(env: Env, cfg: UserConfig): Promise<void> {
  await env.AUTOMERGE.put(userKey(cfg.discordUserId), JSON.stringify(cfg));
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
    mergeStrategy: "squash",
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
  return env.AUTOMERGE.get<RepoConfig>(repoKey(owner, repo), "json");
}

export async function putRepo(env: Env, cfg: RepoConfig): Promise<void> {
  await env.AUTOMERGE.put(repoKey(cfg.owner, cfg.repo), JSON.stringify(cfg));
}

export async function deleteRepo(env: Env, owner: string, repo: string): Promise<void> {
  await env.AUTOMERGE.delete(repoKey(owner, repo));
}

export async function listReposFor(env: Env, discordUserId: string): Promise<RepoConfig[]> {
  const out: RepoConfig[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.AUTOMERGE.list({ prefix: "repo:", cursor });
    for (const k of page.keys) {
      const cfg = await env.AUTOMERGE.get<RepoConfig>(k.name, "json");
      if (cfg?.discordUserId === discordUserId) out.push(cfg);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function setInstallation(env: Env, installationId: number, discordUserId: string) {
  await env.AUTOMERGE.put(installKey(installationId), discordUserId);
}

export async function getInstallationOwner(env: Env, installationId: number): Promise<string | null> {
  return env.AUTOMERGE.get(installKey(installationId));
}

export async function getPRState(env: Env, owner: string, repo: string, n: number) {
  return env.AUTOMERGE.get<PRReviewState>(prKey(owner, repo, n), "json");
}

export async function putPRState(env: Env, owner: string, repo: string, n: number, s: PRReviewState) {
  await env.AUTOMERGE.put(prKey(owner, repo, n), JSON.stringify(s), { expirationTtl: 60 * 60 * 24 * 30 });
}
