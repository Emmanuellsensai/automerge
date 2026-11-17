import type { Env } from "../index";
import { listOpenPRs, type PR } from "../github/api";
import { getSweepLog, getUser, listAllRepos, listPRStates, putSweepLog, type PRReviewState, type RepoConfig } from "../kv/config";
import { reviewPR } from "./review";

// Webhooks handle most reviews instantly. The sweep is a safety net that catches what they
// miss (missed deliveries, AI rate limits, issues assigned after the PR was opened) while
// staying far below GitHub, Gemini, and Workers free-tier limits.
const DEFAULT_INTERVAL_MINUTES = 5;
// Each review costs ~10-14 outbound requests; the Workers free plan allows 50 per invocation.
const DEFAULT_MAX_PRS_PER_RUN = 2;
// Never pick the same PR again within this window, so failures back off instead of looping.
const MIN_GAP_SECONDS = 15 * 60;
// PRs already reviewed on their current commit are re-checked this rarely (gates like
// issue assignment can change without a new push). Unchanged PRs never re-call the AI.
const RECHECK_SECONDS = 6 * 60 * 60;

function num(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
}

function needsWork(pr: PR, state: PRReviewState | undefined, now: number): boolean {
  if (!state) return true;
  if (state.lastCommitSha !== pr.head.sha) return true;
  if (state.status === "merged") return false;
  if (state.status === "queued") return true;
  const last = state.lastReviewAt ? Date.parse(state.lastReviewAt) / 1000 : 0;
  return now - last > RECHECK_SECONDS;
}

export async function maybeSweep(env: Env, scheduledTimeMs: number): Promise<void> {
  const interval = num(env.SWEEP_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES, 1, 1440);
  if (Math.floor(scheduledTimeMs / 60_000) % interval !== 0) return;
  await sweepOpenPRs(env, num(env.SWEEP_MAX_PRS, DEFAULT_MAX_PRS_PER_RUN, 0, 5));
}

export async function sweepOpenPRs(env: Env, maxPrs: number): Promise<void> {
  if (maxPrs === 0) return;
  const now = Math.floor(Date.now() / 1000);
  const repos = await listAllRepos(env);

  type Candidate = { repo: RepoConfig; n: number; lastSwept: number };
  const candidates: Candidate[] = [];
  const logs = new Map<RepoConfig, Record<string, number>>();
  const dirty = new Set<RepoConfig>();

  for (const repo of repos) {
    const user = await getUser(env, repo.discordUserId);
    if (!user?.enabled || (!user.geminiKeyCipher && !user.anthropicKeyCipher)) continue;
    let open: PR[];
    try {
      open = (await listOpenPRs(env, repo.installationId, repo.owner, repo.repo)).filter((p) => !p.draft);
    } catch (e) {
      console.error(`sweep: listOpenPRs failed for ${repo.owner}/${repo.repo}`, e);
      continue;
    }
    const [states, log] = await Promise.all([listPRStates(env, repo.owner, repo.repo), getSweepLog(env, repo.owner, repo.repo)]);
    // Drop entries for PRs that are no longer open so the log stays small.
    const openNums = new Set(open.map((p) => String(p.number)));
    for (const k of Object.keys(log)) {
      if (!openNums.has(k)) {
        delete log[k];
        dirty.add(repo);
      }
    }
    logs.set(repo, log);

    for (const pr of open) {
      const lastSwept = log[String(pr.number)] ?? 0;
      if (now - lastSwept < MIN_GAP_SECONDS) continue;
      if (needsWork(pr, states.get(pr.number), now)) candidates.push({ repo, n: pr.number, lastSwept });
    }
  }

  // Least-recently-swept first, oldest PR number as tiebreak.
  candidates.sort((a, b) => a.lastSwept - b.lastSwept || a.n - b.n);
  const picked = candidates.slice(0, maxPrs);

  const byRepo = new Map<RepoConfig, number[]>();
  for (const c of picked) byRepo.set(c.repo, [...(byRepo.get(c.repo) ?? []), c.n]);

  for (const [repo, nums] of byRepo) {
    const log = logs.get(repo)!;
    for (const n of nums) log[String(n)] = now;
    dirty.add(repo);
    const outcomes = await reviewPR(env, { owner: repo.owner, repo: repo.repo, prNumbers: nums });
    for (const o of outcomes) console.log(`sweep ${repo.owner}/${repo.repo}#${o.number}: ${o.status} ${o.headline}`);
  }
  for (const repo of dirty) await putSweepLog(env, repo.owner, repo.repo, logs.get(repo)!);
  if (picked.length || candidates.length) {
    console.log(`sweep: reviewed ${picked.length}, ${Math.max(0, candidates.length - picked.length)} still waiting`);
  }
}
