import type { Context } from "hono";
import type { Env } from "../index";
import { verifyDiscordRequest } from "./verify";
import { runSetup } from "./commands/setup";
import { runConnect } from "./commands/connect";
import { runRepo } from "./commands/repo";
import { runOnOff } from "./commands/onoff";
import { runStatus } from "./commands/status";
import { runCheck } from "./commands/check";
import { runConfig } from "./commands/config";
import { runHelp } from "./commands/help";
import { runWatchClaims } from "./commands/watch_claims";
import { runLinkGithub } from "./commands/link_github";

// Discord interaction types
const PING = 1;
const APPLICATION_COMMAND = 2;

const PONG = { type: 1 };
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;
const EPHEMERAL = 1 << 6;

export function ephemeral(content: string) {
  return {
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  };
}

export function deferred() {
  return {
    type: DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL },
  };
}

// After deferring, use this to send the real response.
export async function editDeferred(env: Env, interactionToken: string, content: string) {
  const url = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, flags: EPHEMERAL }),
  });
  if (!res.ok) console.error("editDeferred failed", res.status, await res.text());
}

type Handler = (env: Env, ctx: any) => Promise<{ type: number; data: any }>;

const HANDLERS: Record<string, Handler> = {
  setup: (env, ctx) => runSetup(env, ctx),
  connect: (env, ctx) => runConnect(env, ctx),
  repo: (env, ctx) => runRepo(env, ctx),
  on: (env, ctx) => runOnOff(env, { ...ctx, enabled: true }),
  off: (env, ctx) => runOnOff(env, { ...ctx, enabled: false }),
  status: (env, ctx) => runStatus(env, ctx),
  check: (env, ctx) => runCheck(env, ctx),
  config: (env, ctx) => runConfig(env, ctx),
  watch_claims: (env, ctx) => runWatchClaims(env, ctx),
  link_github: (env, ctx) => runLinkGithub(env, ctx),
};

export async function handleDiscordInteraction(c: Context<{ Bindings: Env }>) {
  const rawBody = await c.req.text();
  const ok = await verifyDiscordRequest(c.req.raw, rawBody, c.env.DISCORD_PUBLIC_KEY);
  if (!ok) return c.text("bad signature", 401);

  const interaction = JSON.parse(rawBody);
  if (interaction.type === PING) return c.json(PONG);

  if (interaction.type === APPLICATION_COMMAND) {
    const name: string = interaction.data.name;
    const userId: string = interaction.member?.user?.id ?? interaction.user?.id;
    const guildId: string | undefined = interaction.guild_id;

    // /help is instant — respond directly.
    if (name === "help") return c.json(runHelp());

    const handler = HANDLERS[name];
    if (!handler) return c.json(ephemeral(`Unknown command: /${name}`));

    // Defer immediately so we never miss Discord's 3s deadline, then finish the work in the background.
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const result = await handler(c.env, { userId, guildId, interaction });
          const content = result.data?.content ?? "Done.";
          await editDeferred(c.env, interaction.token, content);
        } catch (e) {
          console.error(`command /${name} failed`, e);
          await editDeferred(c.env, interaction.token, `Sorry, that failed: \`${(e as Error).message}\``);
        }
      })(),
    );
    return c.json(deferred());
  }

  return c.json(ephemeral("Unsupported interaction."));
}
