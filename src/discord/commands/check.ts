import type { Env } from "../../index";
import { getRepo, getUser } from "../../kv/config";
import { ephemeral } from "../interactions";
import { reviewPR } from "../../reviewer/review";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function optVal(interaction: any, name: string): string | undefined {
  return interaction.data?.options?.find((o: any) => o.name === name)?.value;
}

export async function runCheck(env: Env, ctx: CommandContext) {
  const slug = optVal(ctx.interaction, "slug");
  const prArg = optVal(ctx.interaction, "pr");
  const m = slug?.trim().match(/^([^\/\s]+)\/([^\/\s]+)$/);
  if (!m) return ephemeral("Usage: `/check slug:<owner/repo> [pr:<number>]`");
  const [, owner, repo] = m;

  const user = await getUser(env, ctx.userId);
  if (!user?.anthropicKeyCipher || !user.githubInstallationId) {
    return ephemeral("You need `/setup` and `/connect` before running a review.");
  }
  const repoCfg = await getRepo(env, owner!, repo!);
  if (!repoCfg || repoCfg.discordUserId !== ctx.userId) {
    return ephemeral(`Not managing **${owner}/${repo}** — add it with \`/repo add slug:${owner}/${repo}\`.`);
  }
  const prNumber = prArg ? Number(prArg) : undefined;

  // We're already running inside the interaction's executionCtx.waitUntil (see interactions.ts),
  // so awaiting the review here lets us report the real outcome — no silent drops.
  try {
    await reviewPR(env, { owner: owner!, repo: repo!, prNumber, force: true });
  } catch (e) {
    return ephemeral(`Review failed: \`${(e as Error).message}\``);
  }
  return ephemeral(
    prNumber
      ? `Review of **${owner}/${repo}#${prNumber}** finished — check the PR for the comment.`
      : `Reviewed every open PR on **${owner}/${repo}**.`,
  );
}
