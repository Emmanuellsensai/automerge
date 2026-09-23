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
    return ephemeral(`Auto-merge is now **${enabled ? "on" : "off"}**.`);
  }

  if (name === "strategy") {
    const value = optVal(options, "value") as "squash" | "merge" | "rebase" | undefined;
    if (!value || !["squash", "merge", "rebase"].includes(value)) {
      return ephemeral("Usage: `/config strategy value:<squash|merge|rebase>`");
    }
    await upsertUser(env, ctx.userId, { mergeStrategy: value });
    return ephemeral(`Merge strategy set to **${value}**.`);
  }

  return ephemeral("Usage: `/config auto_merge value:<on|off>` or `/config strategy value:<squash|merge|rebase>`");
}
