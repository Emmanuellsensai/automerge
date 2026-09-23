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

// Discord interaction types
const PING = 1;
const APPLICATION_COMMAND = 2;

const PONG = { type: 1 };
const CHANNEL_MESSAGE_WITH_SOURCE = 4;

export function ephemeral(content: string) {
  return {
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: 1 << 6 }, // EPHEMERAL
  };
}

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

    switch (name) {
      case "setup":
        return c.json(await runSetup(c.env, { userId, guildId, interaction }));
      case "connect":
        return c.json(await runConnect(c.env, { userId, guildId, interaction }));
      case "repo":
        return c.json(await runRepo(c.env, { userId, guildId, interaction }));
      case "on":
        return c.json(await runOnOff(c.env, { userId, guildId, enabled: true }));
      case "off":
        return c.json(await runOnOff(c.env, { userId, guildId, enabled: false }));
      case "status":
        return c.json(await runStatus(c.env, { userId, guildId }));
      case "check":
        return c.json(await runCheck(c.env, { userId, guildId, interaction }));
      case "config":
        return c.json(await runConfig(c.env, { userId, guildId, interaction }));
      case "help":
        return c.json(runHelp());
      default:
        return c.json(ephemeral(`Unknown command: /${name}`));
    }
  }

  return c.json(ephemeral("Unsupported interaction."));
}
