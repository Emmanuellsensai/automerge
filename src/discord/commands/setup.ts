import type { Env } from "../../index";
import { encryptSecret } from "../../kv/crypto";
import { upsertUser } from "../../kv/config";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function getOption(interaction: any, name: string): string | undefined {
  const opt = interaction.data?.options?.find((o: any) => o.name === name);
  return opt?.value;
}

export async function runSetup(env: Env, ctx: CommandContext) {
  const key = getOption(ctx.interaction, "gemini_api_key");
  if (!key) {
    return ephemeral(
      "Usage: `/setup gemini_api_key:<your Gemini API key>`\n" +
        "Grab a key at https://aistudio.google.com/app/apikey — it stays encrypted at rest and is only used to review your PRs.",
    );
  }
  const cipher = await encryptSecret(key, env.ENCRYPTION_KEY);
  await upsertUser(env, ctx.userId, {
    discordUserId: ctx.userId,
    guildId: ctx.guildId,
    geminiKeyCipher: cipher,
  });
  return ephemeral(
    "Gemini key saved (encrypted).\n" +
      "Next: run `/connect` and install the AutoMerge GitHub App on the repos you want managed.",
  );
}
