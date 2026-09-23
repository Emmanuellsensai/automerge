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
      ? "AutoMerge is **on**. New PRs will be reviewed and (if configured) auto-merged."
      : "AutoMerge is **paused**. Existing state is kept; no new reviews will run.",
  );
}
