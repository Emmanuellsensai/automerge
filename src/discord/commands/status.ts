import type { Env } from "../../index";
import { getContributor, getUser, getWatch, listReposFor } from "../../kv/config";
import { ephemeral } from "../interactions";

const tick = (done: boolean) => (done ? "✅" : "⬜");

export async function runStatus(env: Env, ctx: { userId: string; guildId?: string }) {
  const user = await getUser(env, ctx.userId);
  const repos = user ? await listReposFor(env, ctx.userId) : [];
  const contributor = await getContributor(env, ctx.userId);
  const watch = ctx.guildId ? await getWatch(env, ctx.guildId) : null;

  const hasKey = !!user?.geminiKeyCipher;
  const hasRepo = repos.length > 0;
  const autoMerge = !!user?.autoMerge;

  const next = !hasKey
    ? "run `/setup` and paste your Gemini API key."
    : !hasRepo
    ? "run `/connect` to install the GitHub App, then `/repo add` with your repo's GitHub link."
    : !autoMerge
    ? "you're set up. AutoMerge reviews every PR. Run `/config auto_merge value:on` if you also want it to merge PRs that pass."
    : "nothing. AutoMerge is reviewing and merging PRs for you.";

  const lines = [
    "**AutoMerge setup checklist**",
    `${tick(hasKey)} 1. Gemini API key saved (\`/setup\`)`,
    `${tick(hasRepo)} 2. GitHub App installed and repo added (\`/connect\`, then \`/repo add\`)`,
    `${tick(autoMerge)} 3. Auto-merge turned on (optional, \`/config auto_merge\`)`,
    "",
    `**Next step:** ${next}`,
  ];

  if (user) {
    lines.push(
      "",
      "**Details**",
      `- Reviewing: ${user.enabled ? "on" : "paused (run `/on` to resume)"}`,
      `- Merge style: ${user.mergeStrategy}`,
      `- Repos: ${hasRepo ? repos.slice(0, 20).map((r) => `${r.owner}/${r.repo}`).join(", ") : "none yet"}`,
    );
  }
  lines.push(`- Your GitHub account: ${contributor ? contributor.githubLogin : "not linked (only needed for issue claims, `/link_github`)"}`);
  if (watch) lines.push(`- Issue claims: <#${watch.channelId}> for ${watch.owner}/${watch.repo}`);

  return ephemeral(lines.join("\n"));
}
