import type { Env } from "../index";
import {
  getClaim,
  getContributor,
  getLastMsg,
  listWatches,
  putClaim,
  putLastMsg,
  type WatchConfig,
} from "../kv/config";
import { addReaction, fetchMessagesAfter, type DiscordMessage } from "../discord/rest";
import { parseIssueRefs } from "./parse";
import { assignIssue, getIssueForClaim } from "./assign";

// Emojis kept short so a maintainer can also react manually to override.
const OK = "✅";
const TAKEN = "⛔";
const UNLINKED = "❓";

export async function pollAllWatches(env: Env): Promise<void> {
  const watches = await listWatches(env);
  if (watches.length === 0) return;
  // Sequential so one channel's error doesn't cascade.
  for (const w of watches) {
    try {
      await pollOneWatch(env, w);
    } catch (e) {
      console.error(`pollOneWatch ${w.channelId}:`, (e as Error).message);
    }
  }
}

async function pollOneWatch(env: Env, w: WatchConfig): Promise<void> {
  const last = await getLastMsg(env, w.channelId);
  const messages = await fetchMessagesAfter(env, w.channelId, last, 100);
  if (messages.length === 0) return;

  // `messages` is chronological after the reverse(); the last one is newest.
  // Advance the cursor even when nothing actionable happens, so idle-chat
  // messages aren't re-fetched on the next tick.
  const newestId = messages[messages.length - 1]!.id;
  for (const msg of messages) {
    if (msg.author?.bot) continue;
    if (!msg.content) continue;
    await handleMessage(env, w, msg);
  }
  await putLastMsg(env, w.channelId, newestId);
}

async function handleMessage(
  env: Env,
  w: WatchConfig,
  msg: DiscordMessage,
): Promise<void> {
  const refs = parseIssueRefs(msg.content, { owner: w.owner, repo: w.repo });
  if (refs.length === 0) return;

  const contributor = await getContributor(env, msg.author.id);
  if (!contributor) {
    // Can't attribute a claim without a linked login.
    await addReaction(env, w.channelId, msg.id, UNLINKED).catch(() => {});
    return;
  }

  for (const ref of refs) {
    // Only touch the repo this channel watches.
    if (ref.owner !== w.owner.toLowerCase() || ref.repo !== w.repo.toLowerCase()) continue;

    const existing = await getClaim(env, ref.owner, ref.repo, ref.number);
    if (existing) {
      // Already recorded (claimed or taken). Skip to keep cost low.
      continue;
    }

    let issue;
    try {
      issue = await getIssueForClaim(env, w.installationId, w.owner, w.repo, ref.number);
    } catch (e) {
      console.error(`getIssue ${w.owner}/${w.repo}#${ref.number}:`, (e as Error).message);
      continue;
    }
    if (!issue || issue.state !== "open") continue;

    if (issue.assignees.length > 0) {
      await putClaim(env, ref.owner, ref.repo, ref.number, {
        githubLogin: issue.assignees[0]!,
        at: new Date().toISOString(),
        status: "already_taken",
        messageId: msg.id,
      });
      await addReaction(env, w.channelId, msg.id, TAKEN).catch(() => {});
      continue;
    }

    const ok = await assignIssue(
      env,
      w.installationId,
      w.owner,
      w.repo,
      ref.number,
      contributor.githubLogin,
    );
    if (ok) {
      await putClaim(env, ref.owner, ref.repo, ref.number, {
        discordUserId: msg.author.id,
        githubLogin: contributor.githubLogin,
        at: new Date().toISOString(),
        status: "claimed",
        messageId: msg.id,
      });
      await addReaction(env, w.channelId, msg.id, OK).catch(() => {});
    } else {
      // Assignment refused (usually 422: login isn't a valid assignee).
      // Don't record so the contributor can retry after fixing perms.
      await addReaction(env, w.channelId, msg.id, TAKEN).catch(() => {});
    }
  }
}
