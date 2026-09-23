import type { Env } from "../../index";
import { getUser } from "../../kv/config";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

// The install URL is https://github.com/apps/<slug>/installations/new?state=<discordUserId>
// The GitHub setup_url callback carries `installation_id` and `state` back to our Worker.
// We store the mapping when the installation webhook arrives (see github/webhook.ts).

export async function runConnect(env: Env, ctx: CommandContext) {
  const user = await getUser(env, ctx.userId);
  if (!user?.anthropicKeyCipher) {
    return ephemeral("Run `/setup` first — I need an Anthropic API key before connecting GitHub.");
  }
  const appSlug = "automerge-wave";
  const url = `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(ctx.userId)}`;
  return ephemeral(
    `Install the AutoMerge GitHub App and pick the repos to manage:\n${url}\n\n` +
      "When you finish, come back and run `/repo list` to confirm.",
  );
}
