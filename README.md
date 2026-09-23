# AutoMerge

Discord bot + GitHub App that reviews and auto-merges PRs on your open-source repositories using **Gemini**.

Any maintainer can install it: run `/setup`, paste a Gemini API key, install the GitHub App on the repos you want managed, and AutoMerge takes it from there. It reads each PR, cross-references the linked issue, checks CI, and either posts review feedback or squashes and merges.

## How it works

```
Discord slash command                GitHub App webhook
        │                                     │
        ▼                                     ▼
   ┌────────────────────────────────────────────────┐
   │        Cloudflare Worker (this repo)           │
   │  Hono router → command handlers / reviewer     │
   └────────┬───────────────────────┬───────────────┘
            │                       │
            ▼                       ▼
       Cloudflare KV            Gemini API
   (config, PR state)      (maintainer's key)
```

Per-user config, per-repo mapping, and per-PR review state live in Cloudflare KV. The maintainer's Gemini API key is encrypted at rest with AES-GCM using a Worker-side `ENCRYPTION_KEY`.

## Slash commands

| Command | What it does |
|---|---|
| `/setup gemini_api_key:<key>` | Save your Gemini API key (encrypted). |
| `/connect` | Install the GitHub App on the repos you own. |
| `/repo add slug:<owner/repo>` | Start managing a repo. |
| `/repo remove slug:<owner/repo>` | Stop managing a repo. |
| `/repo list` | List managed repos. |
| `/on` / `/off` | Resume / pause automatic processing. |
| `/status` | Show config, installation, and repo count. |
| `/check slug:<owner/repo> [pr:<n>]` | Trigger a review right now. |
| `/config auto_merge value:<on\|off>` | Allow AutoMerge to press Merge. |
| `/config strategy value:<squash\|merge\|rebase>` | How to merge. |
| `/help` | Show the help message. |

## Setup

1. **Create the GitHub App**
   Repository permissions: contents (r/w), issues (r/w), pull requests (r/w), checks (r), metadata (r).
   Subscribe to events: pull_request, check_suite, workflow_run, installation.
   Webhook URL: `https://<your-worker>.workers.dev/github/webhook`
   Save the app id, generate a private key (PEM), set a webhook secret.
2. **Create the Discord app**
   Enable "Interactions endpoint URL": `https://<your-worker>.workers.dev/discord/interactions`.
   Note the public key, application id, and bot token.
3. **Provision Cloudflare KV**
   ```bash
   pnpm i
   npx wrangler kv namespace create AUTOMERGE
   npx wrangler kv namespace create AUTOMERGE --preview
   ```
   Paste the returned ids into `wrangler.toml`.
4. **Set secrets**
   ```bash
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_APPLICATION_ID
   npx wrangler secret put DISCORD_BOT_TOKEN
   npx wrangler secret put GITHUB_APP_ID
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY   # paste the PEM
   npx wrangler secret put GITHUB_WEBHOOK_SECRET
   npx wrangler secret put ENCRYPTION_KEY           # 32 bytes base64
   ```
5. **Register slash commands**
   ```bash
   pnpm register-commands
   ```
6. **Deploy**
   ```bash
   pnpm deploy
   ```

## Local dev

```bash
cp .env.example .dev.vars   # fill in secrets
pnpm dev                    # wrangler dev
```

Use a tunnel (e.g. `cloudflared`) to point Discord's interactions URL and the GitHub App webhook at your local Worker.

## Security notes

- Gemini keys are encrypted at rest (AES-GCM, 96-bit random IV). The plaintext lives in memory only long enough to sign a Gemini request.
- Discord interactions are verified via ed25519.
- GitHub webhooks are verified via HMAC-SHA256 with the configured secret.
- Installation tokens are minted per request; nothing longer-lived is cached.

## Roadmap

- GitHub App setup callback: `/github/setup?installation_id=…&state=<discordUserId>` to complete the Discord↔install mapping in one flow.
- Persistent job queue via Cloudflare Queues for retries and rate-limit smoothing.
- Optional Slack front-end for the same reviewer.
- Multiple LLM providers (Claude, OpenAI, OpenRouter) behind the same interface.

## License

MIT — see [LICENSE](./LICENSE).
