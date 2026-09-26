import type { Env } from "../../index";
import { getInstallationForRepo } from "../../github/app";
import { getUser, putWatch } from "../../kv/config";
import { ephemeral } from "../interactions";
import { parseRepo, REPO_HINT } from "../parse-repo";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function optVal(interaction: any, name: string): string | undefined {
  return interaction.data?.options?.find((o: any) => o.name === name)?.value;
}

export async function runWatchClaims(env: Env, ctx: CommandContext) {
  if (!ctx.guildId) return ephemeral("Run this in a server channel, not DMs.");

  const user = await getUser(env, ctx.userId);
  if (!user) return ephemeral("Finish setup first. Run `/status` to see which step is missing.");

  const channelId = optVal(ctx.interaction, "channel");
  const slug = parseRepo(optVal(ctx.interaction, "repo"));
  if (!channelId || !slug) {
    return ephemeral(`Pick a channel and give me the repo. ${REPO_HINT}`);
  }

  const installationId = await getInstallationForRepo(env, slug.owner, slug.repo).catch(() => null);
  if (!installationId) {
    return ephemeral(
      `I can't see **${slug.owner}/${slug.repo}** yet. Run \`/connect\` and install the AutoMerge GitHub App on it first.`,
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
