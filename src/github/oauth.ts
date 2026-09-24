import type { Context } from "hono";
import type { Env } from "../index";
import { consumeOAuthState, putContributor, putOAuthState } from "../kv/config";

// GitHub OAuth (user-to-server) so a contributor can prove they own a GitHub
// login. We only need `read:user` to resolve their login; the App token still
// carries the write scope for assignment.

function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function callbackUrl(env: Env): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/github/oauth/callback`;
}

export function buildStartUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: callbackUrl(env),
    state,
    scope: "read:user",
    allow_signup: "true",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

// /github/oauth/start?u=<discordUserId>
// This is only used when we want an anonymous shareable link. The Discord
// command builds a direct authorize URL itself, so this route mostly exists
// for testing and manual retries.
export async function handleOAuthStart(c: Context<{ Bindings: Env }>) {
  const discordUserId = c.req.query("u");
  if (!discordUserId) return c.text("missing u", 400);
  const state = randomState();
  await putOAuthState(c.env, state, discordUserId);
  return c.redirect(buildStartUrl(c.env, state));
}

export async function handleOAuthCallback(c: Context<{ Bindings: Env }>) {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.text("missing code/state", 400);

  const discordUserId = await consumeOAuthState(c.env, state);
  if (!discordUserId) return c.text("state expired or unknown", 400);

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: c.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: c.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(c.env),
      state,
    }),
  });
  if (!tokenRes.ok) {
    return c.text(`token exchange failed: ${tokenRes.status}`, 500);
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenJson.access_token) {
    return c.text(
      `token exchange rejected: ${tokenJson.error_description ?? tokenJson.error ?? "unknown"}`,
      400,
    );
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "automerge-bot",
    },
  });
  if (!userRes.ok) return c.text(`user lookup failed: ${userRes.status}`, 500);
  const user = (await userRes.json()) as { login?: string };
  if (!user.login) return c.text("no login returned", 500);

  await putContributor(c.env, {
    discordUserId,
    githubLogin: user.login,
    verifiedAt: new Date().toISOString(),
  });

  return c.html(
    `<!doctype html><html><body style="font-family:system-ui;padding:2rem;max-width:36rem;margin:auto">
      <h2>Linked</h2>
      <p>Your Discord account is now linked to GitHub as <b>${escapeHtml(user.login)}</b>.</p>
      <p>You can close this tab and return to Discord. When you post an issue number in a watched channel, AutoMerge will try to assign it to you.</p>
    </body></html>`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
  );
}

// Helper the Discord command uses to mint a state + URL in one call.
export async function newLinkUrl(env: Env, discordUserId: string): Promise<string> {
  const state = randomState();
  await putOAuthState(env, state, discordUserId);
  return buildStartUrl(env, state);
}
