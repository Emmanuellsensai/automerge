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
  if (!user?.geminiKeyCipher || !user.githubInstallationId) {
    return ephemeral("You need `/setup` and `/connect` before running a review.");
  }
  const repoCfg = await getRepo(env, owner!, repo!);
  if (!repoCfg || repoCfg.discordUserId !== ctx.userId) {
    return ephemeral(`Not managing **${owner}/${repo}** — add it with \`/repo add slug:${owner}/${repo}\`.`);
  }
  const prNumber = prArg ? Number(prArg) : undefined;

  // Run in background; reply immediately.
  ctx.interaction._ctx?.waitUntil?.(reviewPR(env, { owner: owner!, repo: repo!, prNumber }));
  return ephemeral(
    prNumber
      ? `Kicked off a review of **${owner}/${repo}#${prNumber}**.`
      : `Kicked off a review of every open PR on **${owner}/${repo}**.`,
  );
}
