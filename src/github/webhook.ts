import type { Context } from "hono";
import type { Env } from "../index";
import { getRepo, setInstallation, upsertUser } from "../kv/config";
import { reviewPR } from "../reviewer/review";

async function verifySignature(secret: string, body: string, headerSig: string | null): Promise<boolean> {
  if (!headerSig?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const expected = `sha256=${hex}`;
  // timing-safe compare
  if (expected.length !== headerSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerSig.charCodeAt(i);
  return diff === 0;
}

export async function handleGitHubWebhook(c: Context<{ Bindings: Env }>) {
  const body = await c.req.text();
  const ok = await verifySignature(c.env.GITHUB_WEBHOOK_SECRET, body, c.req.header("X-Hub-Signature-256") ?? null);
  if (!ok) return c.text("bad signature", 401);

  const event = c.req.header("X-GitHub-Event");
  const payload = JSON.parse(body);
  const installationId: number | undefined = payload.installation?.id;

  // Installation created -> map to the Discord user carried in the state param on the setup callback.
  if (event === "installation") {
    // For installation.created we also want to remember who installed it. GitHub App setup callback
    // preserves ?state=<discordUserId>; we rely on the caller having populated user config via that redirect.
    // Here we just index the installation so lookups from other events work.
    if (installationId && payload.action === "created") {
      // If a Discord user has recently linked, they'll appear via the setup callback route (not implemented here);
      // in the meantime accept a fallback header for local dev: X-AutoMerge-DiscordUser
      const senderLogin: string | undefined = payload.sender?.login;
      // best-effort; production should implement the /github/setup?installation_id&state callback.
      if (senderLogin) await setInstallation(c.env, installationId, senderLogin);
    }
    return c.text("ok");
  }

  if (!installationId) return c.text("ignored: no installation", 202);

  const owner: string | undefined = payload.repository?.owner?.login;
  const repo: string | undefined = payload.repository?.name;
  if (!owner || !repo) return c.text("ignored: no repo", 202);

  const repoCfg = await getRepo(c.env, owner, repo);
  if (!repoCfg) return c.text("ignored: repo not managed", 202);

  // Ensure user's installation is set (helps first-time flows)
  await upsertUser(c.env, repoCfg.discordUserId, { githubInstallationId: installationId });

  const relevant =
    (event === "pull_request" && ["opened", "synchronize", "reopened", "ready_for_review"].includes(payload.action)) ||
    event === "check_suite" ||
    event === "status" ||
    event === "workflow_run";

  if (!relevant) return c.text("ignored: uninteresting event", 202);

  const prNumber: number | undefined =
    payload.pull_request?.number ??
    payload.check_suite?.pull_requests?.[0]?.number ??
    payload.workflow_run?.pull_requests?.[0]?.number;

  // Fire and forget review; return quickly to GitHub.
  c.executionCtx.waitUntil(reviewPR(c.env, { owner, repo, prNumber }));
  return c.text("queued", 202);
}
