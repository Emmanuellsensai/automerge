import type { Env } from "../../index";
import { upsertUser } from "../../kv/config";
import { ephemeral } from "../interactions";

export async function runOnOff(
  env: Env,
  ctx: { userId: string; guildId?: string; enabled: boolean },
) {
  await upsertUser(env, ctx.userId, { enabled: ctx.enabled });
  return ephemeral(
    ctx.enabled
      ? "AutoMerge is **on** again. New pull requests will be reviewed."
      : "AutoMerge is **paused**. It won't review or merge anything until you run `/on`. Your settings are kept.",
  );
}
