import type { Env } from "../index";

const API = "https://discord.com/api/v10";
const UA = "DiscordBot (https://github.com/Emmanuellsensai/automerge, 0.1)";

export type DiscordMessage = {
  id: string;
  channel_id: string;
  author: { id: string; bot?: boolean; username?: string };
  content: string;
  timestamp: string;
};

async function botFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "User-Agent": UA,
      ...(init.headers ?? {}),
    },
  });
}

// GET /channels/{channel_id}/messages?after=&limit=
// `after` is exclusive: Discord returns messages strictly newer than that id.
// Discord returns messages newest-first; we reverse for chronological order.
export async function fetchMessagesAfter(
  env: Env,
  channelId: string,
  afterId: string | null,
  limit = 100,
): Promise<DiscordMessage[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (afterId) q.set("after", afterId);
  const r = await botFetch(env, `/channels/${channelId}/messages?${q.toString()}`);
  if (!r.ok) {
    console.error(`fetchMessagesAfter ${channelId}: ${r.status} ${await r.text()}`);
    return [];
  }
  const msgs = (await r.json()) as DiscordMessage[];
  return msgs.slice().reverse();
}

export async function addReaction(
  env: Env,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const enc = encodeURIComponent(emoji);
  const r = await botFetch(
    env,
    `/channels/${channelId}/messages/${messageId}/reactions/${enc}/@me`,
    { method: "PUT" },
  );
  if (!r.ok && r.status !== 429) {
    console.error(`addReaction ${channelId}/${messageId} ${emoji}: ${r.status}`);
  }
}
