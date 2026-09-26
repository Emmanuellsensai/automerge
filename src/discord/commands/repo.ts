import type { Env } from "../../index";
import { deleteRepo, getRepo, getUser, listReposFor, putRepo, setInstallation, upsertUser } from "../../kv/config";
import { getInstallationForRepo } from "../../github/app";
import { ephemeral } from "../interactions";
import { parseRepo, REPO_HINT } from "../parse-repo";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function subcommand(interaction: any): { name: string; options: any[] } {
  const sub = interaction.data?.options?.[0];
  return { name: sub?.name ?? "list", options: sub?.options ?? [] };
}
function optVal(options: any[], name: string): string | undefined {
  return options.find((o) => o.name === name)?.value;
}

export async function runRepo(env: Env, ctx: CommandContext) {
  const user = await getUser(env, ctx.userId);
  if (!user) {
    return ephemeral("Step 1 isn't done yet. Run `/setup` and paste your Gemini API key first. `/help` walks you through it.");
  }
  const { name, options } = subcommand(ctx.interaction);

  if (name === "add") {
    const slug = parseRepo(optVal(options, "slug"));
    if (!slug) return ephemeral(`I couldn't read that repo. ${REPO_HINT}`);

    // Auto-discover the installation for this repo using the App's own credentials.
    let installationId = user.githubInstallationId;
    const discovered = await getInstallationForRepo(env, slug.owner, slug.repo).catch(() => null);
    if (discovered) {
      installationId = discovered;
      if (installationId !== user.githubInstallationId) {
        await upsertUser(env, ctx.userId, { githubInstallationId: installationId });
        await setInstallation(env, installationId, ctx.userId);
      }
    }
    if (!installationId) {
      return ephemeral(
        `I can't see **${slug.owner}/${slug.repo}** yet. The AutoMerge GitHub App isn't installed on it.\n\n` +
          "**Fix:** run `/connect`, click the link, tick this repo, press Install, then run this command again.",
      );
    }
    await putRepo(env, {
      owner: slug.owner,
      repo: slug.repo,
      discordUserId: ctx.userId,
      installationId,
      addedAt: new Date().toISOString(),
    });
    return ephemeral(`Done! AutoMerge is now watching **${slug.owner}/${slug.repo}**. Every new pull request will get a review comment.\n\n` +
        "**Last step (optional):** run `/config auto_merge value:on` if you want AutoMerge to also merge PRs that pass every check. Until then it only comments.");
  }

  if (name === "remove") {
    const slug = parseRepo(optVal(options, "slug"));
    if (!slug) return ephemeral(`I couldn't read that repo. ${REPO_HINT}`);
    const existing = await getRepo(env, slug.owner, slug.repo);
    if (!existing || existing.discordUserId !== ctx.userId) {
      return ephemeral("AutoMerge isn't watching that repo, so there is nothing to remove. `/repo list` shows what it watches.");
    }
    await deleteRepo(env, slug.owner, slug.repo);
    return ephemeral(`Stopped watching **${slug.owner}/${slug.repo}**. Nothing on GitHub was changed.`);
  }

  // list
  const repos = await listReposFor(env, ctx.userId);
  if (repos.length === 0) return ephemeral("AutoMerge isn't watching any repos yet. Add one with `/repo add` and paste the repo's GitHub link.");
  return ephemeral(
    ["**Repos AutoMerge is watching:**", ...repos.map((r) => `- ${r.owner}/${r.repo}`)].join("\n"),
  );
}
