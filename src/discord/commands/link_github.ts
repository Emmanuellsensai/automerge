import type { Env } from "../../index";
import { newLinkUrl } from "../../github/oauth";
import { getContributor } from "../../kv/config";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

export async function runLinkGithub(env: Env, ctx: CommandContext) {
  const url = await newLinkUrl(env, ctx.userId);
  const existing = await getContributor(env, ctx.userId);
  const already = existing
    ? `Currently linked as **${existing.githubLogin}**. Re-linking will overwrite that.\n\n`
    : "";
  return ephemeral(
    `${already}Click to link your GitHub account (one-time, 10-minute window):\n${url}\n\n` +
      "After you approve, I can assign issues to you when you claim them here.",
  );
}
