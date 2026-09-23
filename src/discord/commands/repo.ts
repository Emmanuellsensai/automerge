import type { Env } from "../../index";
import { deleteRepo, getRepo, getUser, listReposFor, putRepo, setInstallation, upsertUser } from "../../kv/config";
import { getInstallationForRepo } from "../../github/app";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function subcommand(interaction: any): { name: string; options: any[] } {
  const sub = interaction.data?.options?.[0];
  return { name: sub?.name ?? "list", options: sub?.options ?? [] };
}
function optVal(options: any[], name: string): string | undefined {
  return options.find((o) => o.name === name)?.value;
}
function parseSlug(slug?: string): { owner: string; repo: string } | null {
  if (!slug) return null;
  const m = slug.trim().match(/^([^\/\s]+)\/([^\/\s]+)$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

export async function runRepo(env: Env, ctx: CommandContext) {
  const user = await getUser(env, ctx.userId);
  if (!user) {
    return ephemeral("Run `/setup` first — I need your Gemini key before I can manage repos.");
  }
  const { name, options } = subcommand(ctx.interaction);

  if (name === "add") {
    const slug = parseSlug(optVal(options, "slug"));
    if (!slug) return ephemeral("Usage: `/repo add slug:<owner/repo>`");

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
        `I can't see **${slug.owner}/${slug.repo}** — install the AutoMerge GitHub App on it first via \`/connect\`, ` +
          "then re-run this command.",
      );
    }
    await putRepo(env, {
      owner: slug.owner,
      repo: slug.repo,
      discordUserId: ctx.userId,
      installationId,
      addedAt: new Date().toISOString(),
    });
    return ephemeral(`Now managing **${slug.owner}/${slug.repo}**. New PRs will be reviewed automatically.`);
  }

  if (name === "remove") {
    const slug = parseSlug(optVal(options, "slug"));
    if (!slug) return ephemeral("Usage: `/repo remove slug:<owner/repo>`");
    const existing = await getRepo(env, slug.owner, slug.repo);
    if (!existing || existing.discordUserId !== ctx.userId) {
      return ephemeral("Not currently managing that repo.");
    }
    await deleteRepo(env, slug.owner, slug.repo);
    return ephemeral(`Removed **${slug.owner}/${slug.repo}**.`);
  }

  // list
  const repos = await listReposFor(env, ctx.userId);
  if (repos.length === 0) return ephemeral("No repos managed yet. Add one with `/repo add slug:<owner/repo>`.");
  return ephemeral(
    ["**Managed repos:**", ...repos.map((r) => `- ${r.owner}/${r.repo}`)].join("\n"),
  );
}
