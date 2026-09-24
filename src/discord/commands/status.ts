import type { Env } from "../../index";
import { getContributor, getUser, getWatch, listReposFor } from "../../kv/config";
import { ephemeral } from "../interactions";

export async function runStatus(env: Env, ctx: { userId: string; guildId?: string }) {
  const user = await getUser(env, ctx.userId);
  if (!user) return ephemeral("Not set up. Run `/setup` to begin.");
  const repos = await listReposFor(env, ctx.userId);
  const contributor = await getContributor(env, ctx.userId);
  const watch = ctx.guildId ? await getWatch(env, ctx.guildId) : null;
  const lines = [
    "**AutoMerge status**",
    `- Anthropic key: ${user.anthropicKeyCipher ? "linked" : "missing"}`,
    `- GitHub installation: ${user.githubInstallationId ? `#${user.githubInstallationId}` : "not connected"}`,
    `- GitHub login (you): ${contributor ? contributor.githubLogin : "not linked (`/link_github`)"}`,
    `- Processing: ${user.enabled ? "on" : "paused"}`,
    `- Auto-merge: ${user.autoMerge ? `on (${user.mergeStrategy})` : "off"}`,
    `- Managed repos: ${repos.length}`,
    ...repos.slice(0, 20).map((r) => `  • ${r.owner}/${r.repo}`),
  ];
  if (watch) {
    lines.push(`- Claim watch: <#${watch.channelId}> -> ${watch.owner}/${watch.repo}`);
  }
  return ephemeral(lines.join("\n"));
}
