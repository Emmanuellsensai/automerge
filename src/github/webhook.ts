import type { Context } from "hono";
import type { Env } from "../index";
import { getRepo, putRepo } from "../kv/config";
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

  // Installations are mapped to Discord users by `/repo add`, which discovers the
  // installation id through the App's own credentials.
  if (event === "installation" || event === "installation_repositories") return c.text("ok");

  if (!installationId) return c.text("ignored: no installation", 202);

  const owner: string | undefined = payload.repository?.owner?.login;
  const repo: string | undefined = payload.repository?.name;
  if (!owner || !repo) return c.text("ignored: no repo", 202);

  const relevant =
    (event === "pull_request" &&
      ["opened", "synchronize", "reopened", "ready_for_review", "edited"].includes(payload.action)) ||
    (event === "check_suite" && payload.action === "completed") ||
    (event === "workflow_run" && payload.action === "completed") ||
    event === "status";

  if (!relevant) return c.text("ignored: uninteresting event", 202);

  // Description edits only matter when the text changed (e.g. a `Closes #N` line was added).
  if (event === "pull_request" && payload.action === "edited" && !payload.changes?.body && !payload.changes?.title) {
    return c.text("ignored: edit without body/title change", 202);
  }

  const repoCfg = await getRepo(c.env, owner, repo);
  if (!repoCfg) return c.text("ignored: repo not managed", 202);

  if (repoCfg.installationId !== installationId) {
    await putRepo(c.env, { ...repoCfg, installationId });
  }

  const prNumber: number | undefined =
    payload.pull_request?.number ??
    payload.check_suite?.pull_requests?.[0]?.number ??
    payload.workflow_run?.pull_requests?.[0]?.number;

  // Fork PRs arrive with an empty pull_requests list, so fall back to matching by head SHA.
  const headSha: string | undefined =
    payload.sha ?? payload.check_suite?.head_sha ?? payload.workflow_run?.head_sha;

  if (!prNumber && !headSha) return c.text("ignored: no PR or sha", 202);

  c.executionCtx.waitUntil(
    reviewPR(c.env, { owner, repo, prNumber, headSha }).then(
      () => undefined,
      (e) => console.error("reviewPR failed", e),
    ),
  );
  return c.text("queued", 202);
}
