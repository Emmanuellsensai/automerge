import type { Env } from "../../index";
import { encryptSecret } from "../../kv/crypto";
import { upsertUser } from "../../kv/config";
import { DEFAULT_GEMINI_MODEL } from "../../reviewer/gemini";
import { ephemeral } from "../interactions";

type CommandContext = { userId: string; guildId?: string; interaction: any };

function getOption(interaction: any, name: string): string | undefined {
  const opt = interaction.data?.options?.find((o: any) => o.name === name);
  return opt?.value;
}

async function validateGeminiKey(key: string, model: string): Promise<string | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
    { headers: { "x-goog-api-key": key } },
  );
  if (res.ok) return null;
  const body = await res.text();
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return "Google says that key isn't valid. Copy it again from https://aistudio.google.com/apikey (it usually starts with `AIza`) and run `/setup` again.";
  }
  if (res.status === 404) return `The key works but model \`${model}\` was not found for it.`;
  return `Could not verify the key (Gemini ${res.status}: ${body.slice(0, 120)}).`;
}

export async function runSetup(env: Env, ctx: CommandContext) {
  const key = getOption(ctx.interaction, "gemini_api_key")?.trim();
  if (!key) {
    return ephemeral(
      "Paste your Gemini API key after `/setup`.\n" +
        "Don't have one? Go to https://aistudio.google.com/apikey, sign in with Google, click **Create API key**, and copy it.",
    );
  }
  const problem = await validateGeminiKey(key, env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
  if (problem) return ephemeral(problem);

  const cipher = await encryptSecret(key, env.ENCRYPTION_KEY);
  await upsertUser(env, ctx.userId, {
    discordUserId: ctx.userId,
    guildId: ctx.guildId,
    geminiKeyCipher: cipher,
  });
  return ephemeral(
    "Step 1 done: your Gemini key works and is saved (encrypted, only used to review your PRs).\n\n" +
      "**Next:** run `/connect` to give AutoMerge access to your GitHub repo.",
  );
}
