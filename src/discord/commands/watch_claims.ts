import type { Env } from "../../index";
import { getInstallationForRepo } from "../../github/app";
import { getUser, putWatch } from "../../kv/config";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function optVal(interaction: any, name: string): string | undefined {
  return interaction.data?.options?.find((o: any) => o.name === name)?.value;
}

function parseSlug(slug?: string): { owner: string; repo: string } | null {
  if (!slug) return null;
  const m = slug.trim().match(/^([^\/\s]+)\/([^\/\s]+)$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export async function runWatchClaims(env: Env, ctx: CommandContext) {
  if (!ctx.guildId) return ephemeral("Run this in a server channel, not DMs.");

  const user = await getUser(env, ctx.userId);
  if (!user) return ephemeral("Run `/setup` first.");

  const channelId = optVal(ctx.interaction, "channel");
  const slug = parseSlug(optVal(ctx.interaction, "repo"));
  if (!channelId || !slug) {
    return ephemeral("Usage: `/watch_claims channel:<#channel> repo:<owner/repo>`");
  }

  const installationId = await getInstallationForRepo(env, slug.owner, slug.repo).catch(() => null);
  if (!installationId) {
    return ephemeral(
      `I can't see **${slug.owner}/${slug.repo}** — install the AutoMerge GitHub App on it first via \`/connect\`.`,
    );
  }

  await putWatch(env, {
    guildId: ctx.guildId,
    channelId,
    owner: slug.owner,
    repo: slug.repo,
    installationId,
    discordUserId: ctx.userId,
    addedAt: new Date().toISOString(),
  });
  return ephemeral(
    `Watching <#${channelId}> for issue claims on **${slug.owner}/${slug.repo}**.\n` +
      "Contributors need to run `/link_github` once so I know their GitHub login.\n" +
      "First person to post `#N` or the issue URL gets the assignment.",
  );
}
