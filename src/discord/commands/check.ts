import type { Env } from "../../index";
import { getRepo, getUser } from "../../kv/config";
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

  // Already inside the interaction's waitUntil (see interactions.ts), so we can await the real outcome.
  let outcomes;
  try {
    outcomes = await reviewPR(env, { owner: owner!, repo: repo!, prNumber, force: true });
  } catch (e) {
    return ephemeral(`Review failed: \`${(e as Error).message}\``);
  }
  if (outcomes.length === 0) {
    return ephemeral(
      prNumber
        ? `Nothing to review on **${owner}/${repo}#${prNumber}** (closed, or processing is paused with \`/off\`).`
        : `No open PRs to review on **${owner}/${repo}**.`,
    );
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
