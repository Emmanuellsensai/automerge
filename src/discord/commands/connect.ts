import type { Env } from "../../index";
import { getUser } from "../../kv/config";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

// The install URL is https://github.com/apps/<slug>/installations/new?state=<discordUserId>
// The GitHub setup_url callback carries `installation_id` and `state` back to our Worker.
// We store the mapping when the installation webhook arrives (see github/webhook.ts).

export async function runConnect(env: Env, ctx: CommandContext) {
  const user = await getUser(env, ctx.userId);
  if (!(user?.geminiKeyCipher || user?.anthropicKeyCipher)) {
    return ephemeral("Step 1 isn't done yet. Run `/setup` and paste your Gemini API key first. `/help` walks you through it.");
  }
  const appSlug = "automerge-wave";
  const url = `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(ctx.userId)}`;
  return ephemeral(
    `**Step 2: give AutoMerge access to your repo**\n` +
      `1. Open this link: ${url}\n` +
      "2. Pick your account (or organization).\n" +
      "3. Choose **Only select repositories**, tick the repo(s) you want AutoMerge to look after, and press **Install**.\n" +
      "4. Come back here and run `/repo add`, pasting the repo's GitHub link.",
  );
}
