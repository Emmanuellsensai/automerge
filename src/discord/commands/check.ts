import type { Env } from "../../index";
import { getRepo, getSweepLog, getUser, putSweepLog } from "../../kv/config";
import { listOpenPRs } from "../../github/api";
import { FORCE_KEY } from "../../reviewer/sweep-due";
import { ephemeral } from "../interactions";
import { reviewPR } from "../../reviewer/review";
import { parseRepo, REPO_HINT } from "../parse-repo";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function optVal(interaction: any, name: string): string | undefined {
  return interaction.data?.options?.find((o: any) => o.name === name)?.value;
}

export async function runCheck(env: Env, ctx: CommandContext) {
  const slug = optVal(ctx.interaction, "slug");
  const prArg = optVal(ctx.interaction, "pr");
  const parsed = parseRepo(slug);
  if (!parsed) return ephemeral(`I couldn't read that repo. ${REPO_HINT}`);
  const { owner, repo } = parsed;
  // A pasted PR link carries the number too.
  const prFromUrl = slug?.match(/\/pull\/(\d+)/)?.[1];

  const user = await getUser(env, ctx.userId);
  if (!(user?.geminiKeyCipher || user?.anthropicKeyCipher) || !user.githubInstallationId) {
    return ephemeral("Setup isn't finished yet. Run `/status` to see which step is missing.");
  }
  const repoCfg = await getRepo(env, owner!, repo!);
  if (!repoCfg || repoCfg.discordUserId !== ctx.userId) {
    return ephemeral(`AutoMerge isn't watching **${owner}/${repo}** yet. Add it first with \`/repo add\`.`);
  }
  const prNumber = prArg ? Number(prArg) : prFromUrl ? Number(prFromUrl) : undefined;

  // A whole-repo check can't review every PR inside one Discord command (the Workers free plan
  // allows ~50 outbound requests per invocation and a review uses ~12). Instead, mark every open
  // PR as due; the background sweep then re-checks them a couple at a time.
  if (!prNumber) {
    const open = (await listOpenPRs(env, repoCfg.installationId, owner!, repo!)).filter((p) => !p.draft);
    if (open.length === 0) return ephemeral(`No open PRs to review on **${owner}/${repo}**.`);
    const log = await getSweepLog(env, owner!, repo!);
    log[FORCE_KEY] = Math.floor(Date.now() / 1000);
    await putSweepLog(env, owner!, repo!, log);
    const perRun = sweepNum(env.SWEEP_MAX_PRS, 2, 1, 5);
    const every = sweepNum(env.SWEEP_INTERVAL_MINUTES, 5, 1, 1440);
    const minutes = Math.ceil(open.length / perRun) * every;
    return ephemeral(
      `Queued all **${open.length}** open PRs on **${owner}/${repo}** for a fresh check. ` +
        `I re-check ${perRun} every ${every} minute${every === 1 ? "" : "s"}, so all of them should be done in about **${minutes} minutes**. ` +
        "Each PR's AutoMerge comment updates as it is checked. For one PR right now, add `pr:<number>`.",
    );
  }

  // Already inside the interaction's waitUntil (see interactions.ts), so we can await the real outcome.
  let outcomes;
  try {
    // A maintainer asking about one PR gets a fresh AI review.
    outcomes = await reviewPR(env, { owner: owner!, repo: repo!, prNumber, force: true, freshAi: true });
  } catch (e) {
    return ephemeral(`Review failed: \`${(e as Error).message}\``);
  }
  if (outcomes.length === 0) {
    return ephemeral(`Nothing to review on **${owner}/${repo}#${prNumber}** (closed, or processing is paused with \`/off\`).`);
  }
  const lines: string[] = [];
  for (const o of outcomes.slice(0, 10)) {
    lines.push(`**#${o.number}** ${o.headline}${o.url ? ` (<${o.url}>)` : ""}`);
    for (const s of o.steps.slice(0, 5)) lines.push(`  - ${s.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  if (outcomes.length > 10) lines.push(`...and ${outcomes.length - 10} more.`);
  // Discord caps message content at 2000 characters.
  return ephemeral(lines.join("\n").slice(0, 1990));
}

function sweepNum(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
}
