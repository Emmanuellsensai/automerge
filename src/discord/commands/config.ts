import type { Env } from "../../index";
import { upsertUser } from "../../kv/config";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function subcommand(interaction: any): { name: string; options: any[] } {
  const sub = interaction.data?.options?.[0];
  return { name: sub?.name ?? "", options: sub?.options ?? [] };
}
function optVal(options: any[], name: string): string | undefined {
  return options.find((o) => o.name === name)?.value;
}

export async function runConfig(env: Env, ctx: CommandContext) {
  const { name, options } = subcommand(ctx.interaction);

  if (name === "auto_merge") {
    const value = optVal(options, "value");
    const enabled = value === "on";
    await upsertUser(env, ctx.userId, { autoMerge: enabled });
    return ephemeral(
      enabled
        ? "Auto-merge is **on**. When a PR passes every check (linked issue, assigned author, tests passing, AI review approved), AutoMerge will merge it for you."
        : "Auto-merge is **off**. AutoMerge will still review PRs and tell contributors what to fix, but a person has to press Merge.",
    );
  }

  if (name === "strategy") {
    const value = optVal(options, "value") as "squash" | "merge" | "rebase" | undefined;
    if (!value || !["squash", "merge", "rebase"].includes(value)) {
      return ephemeral("Pick one of: squash (recommended), merge, or rebase.");
    }
    await upsertUser(env, ctx.userId, { mergeStrategy: value });
    const explain = { squash: "all the PR's commits become one tidy commit (recommended)", merge: "keeps every commit plus a merge commit", rebase: "replays each commit on top of the main branch" }[value];
    return ephemeral(`Merge style set to **${value}**: ${explain}.`);
  }

  return ephemeral("Use `/config auto_merge` to turn merging on or off, or `/config strategy` to pick how PRs are merged.");
}
