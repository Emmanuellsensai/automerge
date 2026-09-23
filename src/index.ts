import { Hono } from "hono";
import { handleDiscordInteraction } from "./discord/interactions";
import { handleGitHubWebhook } from "./github/webhook";

export type Env = {
  AUTOMERGE: KVNamespace;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  ENCRYPTION_KEY: string;
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

export default app;
