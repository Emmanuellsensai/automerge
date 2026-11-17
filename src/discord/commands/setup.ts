import type { Env } from "../../index";
import { encryptSecret } from "../../kv/crypto";
import { upsertUser, type UserConfig } from "../../kv/config";
import { DEFAULT_GEMINI_MODEL } from "../../reviewer/gemini";
import { DEFAULT_ANTHROPIC_MODEL, validateAnthropicKey } from "../../reviewer/claude";
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
    return "Google says that Gemini key isn't valid. Copy it again from https://aistudio.google.com/apikey (it usually starts with `AIza`) and run `/setup` again.";
  }
  if (res.status === 404) return `The key works but model \`${model}\` was not found for it.`;
  return `Could not verify the key (Gemini ${res.status}: ${body.slice(0, 120)}).`;
}

export async function runSetup(env: Env, ctx: CommandContext) {
  const geminiKey = getOption(ctx.interaction, "gemini_api_key")?.trim();
  const anthropicKey = getOption(ctx.interaction, "anthropic_api_key")?.trim();
  if (!geminiKey && !anthropicKey) {
    return ephemeral(
      "Paste your Gemini API key after `/setup`.\n" +
        "Don't have one? Go to https://aistudio.google.com/apikey, sign in with Google, click **Create API key**, and copy it.\n\n" +
        "Optional backup: also paste an Anthropic key in `anthropic_api_key`. AutoMerge only uses it when Gemini is busy or out of quota.",
    );
  }

  const [geminiProblem, anthropicProblem] = await Promise.all([
    geminiKey ? validateGeminiKey(geminiKey, env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL) : null,
    anthropicKey ? validateAnthropicKey(anthropicKey, env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL) : null,
  ]);
  if (geminiProblem || anthropicProblem) {
    return ephemeral([geminiProblem, anthropicProblem].filter(Boolean).join("\n\n") + "\n\nNothing was saved.");
  }

  const patch: Partial<UserConfig> = { discordUserId: ctx.userId, guildId: ctx.guildId };
  if (geminiKey) patch.geminiKeyCipher = await encryptSecret(geminiKey, env.ENCRYPTION_KEY);
  if (anthropicKey) patch.anthropicKeyCipher = await encryptSecret(anthropicKey, env.ENCRYPTION_KEY);
  const user = await upsertUser(env, ctx.userId, patch);

  const saved = [geminiKey && "Gemini key", anthropicKey && "Anthropic backup key"].filter(Boolean).join(" and ");
  const lines = [`Saved your ${saved} (checked, then encrypted; only used to review your PRs).`];
  if (!user.geminiKeyCipher) lines.push("Tip: add a Gemini key too with `/setup gemini_api_key:...`. Gemini is the main reviewer; Anthropic is the backup.");
  else if (!user.anthropicKeyCipher) lines.push("Optional: add a backup with `/setup anthropic_api_key:...` so reviews keep working when Gemini hits its rate limit.");
  lines.push("", "**Next:** run `/connect` to give AutoMerge access to your GitHub repo (skip if you already did).");
  return ephemeral(lines.join("\n"));
}
