import { Hono } from "hono";
import { handleDiscordInteraction } from "./discord/interactions";
import { handleGitHubWebhook } from "./github/webhook";
import { handleOAuthStart, handleOAuthCallback } from "./github/oauth";
import { pollAllWatches } from "./claims/poll";

export type Env = {
  DB: D1Database;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  ENCRYPTION_KEY: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  PUBLIC_BASE_URL: string;
  GEMINI_MODEL?: string;
  ANTHROPIC_MODEL?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.text(
    "AutoMerge is running. Add the bot to your Discord server and run /setup to connect a GitHub App installation.",
  ),
);

app.get("/health", (c) => c.json({ ok: true, service: "automerge" }));

app.post("/discord/interactions", (c) => handleDiscordInteraction(c));
app.post("/github/webhook", (c) => handleGitHubWebhook(c));
app.get("/github/oauth/start", (c) => handleOAuthStart(c));
app.get("/github/oauth/callback", (c) => handleOAuthCallback(c));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pollAllWatches(env));
  },
};
