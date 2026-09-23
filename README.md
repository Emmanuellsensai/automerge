# AutoMerge

**A Discord bot and GitHub App that reviews and squash-merges pull requests using Claude Haiku 4.5.**

Any maintainer can install it. Run `/setup`, paste an Anthropic API key, install the AutoMerge GitHub App on your repos, and AutoMerge takes it from there. It reads each PR, cross-references the linked issue, checks CI, and either posts review feedback or squash-merges the PR when it is clean.

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1552301499139493888&scope=applications.commands+bot"><img alt="Add to Discord" src="https://img.shields.io/badge/Add%20to-Discord-5865F2?logo=discord&logoColor=white&style=for-the-badge"></a>
  &nbsp;
  <a href="https://github.com/apps/automerge-wave"><img alt="Install on GitHub" src="https://img.shields.io/badge/Install%20on-GitHub-24292e?logo=github&logoColor=white&style=for-the-badge"></a>
</p>

> **Full step-by-step guide:** [docs/install.md](./docs/install.md)

## What it does

* **Reads every PR** opened on your managed repos.
* **Finds the linked issue** via `Closes #N` or `Fixes #N`.
* **Runs the diff through Claude Haiku 4.5** with a strict reviewer prompt.
* **Checks CI** on the head commit. Preview-deploy checks (Vercel, Netlify, Cloudflare Pages, Render) are ignored.
* **Comments on the PR** with a clear, addressable review.
* **Squash-merges** the PR only when every one of the five strict gates passes.

## The strict five-gate merge rule

AutoMerge merges a PR **only when all five are true**. A single failure blocks the merge:

1. **Claude verdict is `approve`.** Not `request_changes` or `comment`.
2. **Claude confirms the PR addresses the linked issue.**
3. **CI on the head commit is passing.** Missing, pending, or failing blocks the merge.
4. **Maintainer has `/config auto_merge value:on`.**
5. **PR author is an official assignee of the linked issue.**

Drafts are never approved. PRs with no `Closes #N` reference are automatically flagged for changes.

## Slash commands

| Command | What it does |
|---|---|
| `/setup anthropic_api_key:<key>` | Save your Anthropic API key (encrypted). |
| `/connect` | Get the GitHub App install link. |
| `/repo add slug:<owner/repo>` | Start managing a repo. |
| `/repo remove slug:<owner/repo>` | Stop managing a repo. |
| `/repo list` | Show managed repos. |
| `/on` and `/off` | Resume or pause automatic processing. |
| `/status` | Show config, installation, and repo count. |
| `/check slug:<owner/repo> [pr:<n>]` | Trigger a review right now. |
| `/config auto_merge value:<on\|off>` | Allow AutoMerge to press Merge. |
| `/config strategy value:<squash\|merge\|rebase>` | How to merge. |
| `/help` | Show the command list. |

## Cost

Each review calls Claude Haiku 4.5 once. Typical cost is **about $0.007 per PR**. **$5 in Anthropic credit covers roughly 700 reviews.**

You pay only for your own API usage. The bot runs on the Cloudflare Workers free tier.

## Architecture

```
Discord slash command                GitHub App webhook
        |                                     |
        v                                     v
+------------------------------------------------+
|          Cloudflare Worker (this repo)         |
|   Hono router -> command handlers / reviewer   |
+------------+-------------------------+---------+
             |                         |
             v                         v
      Cloudflare KV           Anthropic Messages API
   (config, PR state)          (Claude Haiku 4.5)
```

Per-user config, per-repo mapping, and per-PR review state live in Cloudflare KV. Your Anthropic API key is encrypted with AES-GCM using a Worker-side `ENCRYPTION_KEY`.

## Security

* **Anthropic keys are encrypted at rest** (AES-GCM, 96-bit random IV). Plaintext lives in memory only during a review.
* **Discord interactions are verified** via ed25519.
* **GitHub webhooks are verified** via HMAC-SHA256.
* **Installation tokens are minted per request.** Nothing longer-lived is cached.
* **No PR content, diff, or issue body is stored** past the duration of a review.

## Self-host

If you want to run your own AutoMerge instance instead of using the hosted one, everything you need is in this repo.

1. `pnpm install`
2. Create your own Discord app and GitHub App.
3. `npx wrangler kv namespace create AUTOMERGE`. Paste the ids into `wrangler.toml`.
4. Set the 7 secrets with `wrangler secret put`. Full list is in `.env.example`.
5. `pnpm register-commands`
6. `pnpm deploy`

Full self-hosting details are in `wrangler.toml` comments and this repo's history.

## Roadmap

* **GitHub App Setup URL callback.** Cleaner Discord to installation mapping in one flow.
* **Cloudflare Queues.** Retry and rate-limit smoothing at high volume.
* **Multi-provider LLM support.** Gemini, OpenAI, OpenRouter behind the same reviewer interface.
* **Slack front-end** for the same reviewer.
* **Public dashboard** showing per-repo review stats.

## License

MIT. See [LICENSE](./LICENSE).
