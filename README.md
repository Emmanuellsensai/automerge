# AutoMerge

**A Discord bot and GitHub App that reviews pull requests with Google Gemini, tells contributors exactly what to fix, and merges them when they pass.**

Anyone who maintains a GitHub repo can use it. No coding needed: you type a few commands in Discord, click one install link on GitHub, and AutoMerge takes it from there.

<p align="center">
  <a href="https://discord.com/oauth2/authorize?client_id=1552301499139493888&scope=applications.commands+bot"><img alt="Add to Discord" src="https://img.shields.io/badge/Add%20to-Discord-5865F2?logo=discord&logoColor=white&style=for-the-badge"></a>
  &nbsp;
  <a href="https://github.com/apps/automerge-wave"><img alt="Install on GitHub" src="https://img.shields.io/badge/Install%20on-GitHub-24292e?logo=github&logoColor=white&style=for-the-badge"></a>
</p>

> **Step-by-step setup guide (5 minutes, no coding):** [docs/install.md](./docs/install.md)

## What it does

* **Reads every pull request** on the repos you choose.
* **Checks the basics first, for free:** the PR links an issue, the author is assigned to that issue, it doesn't add dependencies, and it only touches the files the issue is about.
* **Reviews the code with Gemini**, once per commit. If Gemini is rate-limited or out of quota, an optional **Anthropic (Claude) backup key** takes over so reviews don't stall.
* **Posts one comment with a numbered to-do list** for the contributor: which file and line, what is wrong, and the exact fix (including the git commands for things like merge conflicts). The comment updates itself on every push, so the PR page never fills up with old reviews.
* **Lets first-time contributors' tests run** by approving their waiting workflow runs.
* **Merges the PR** when everything passes, if you turned auto-merge on.
* **Double-checks open PRs in the background** every 5 minutes (at most 2 per run), catching anything a webhook missed or a rate limit delayed. PRs that haven't changed are never sent to the AI again.
* **Optional issue claims:** people post an issue number in a Discord channel and the first one gets assigned on GitHub.

## What a contributor sees

```
AutoMerge: changes needed before this can merge

@xtep103 Close, but a couple of things are off.

What to do to get this merged:
1. Fix the failing automatic test (CI).
   - test: 2 tests failed (open the log)
2. The issue asks for something this PR doesn't do yet: show "No activity" when a contract has no events.
3. src/contracts.ts:12: ledger_closed_at is parsed as local time.
   Fix: use new Date(row.ledger_closed_at).toISOString()
```

## When does it merge?

Only when **all** of these are true:

1. The PR says which issue it solves (`Closes #123` in the description).
2. The PR author is assigned to that issue.
3. No dependency files were changed (`package.json`, lockfiles, `go.mod`, `Cargo.toml`, and similar). New dependencies need a human.
4. Every changed file is one the issue mentions (file paths written in backticks in the issue). Tests and docs are always allowed.
5. No merge conflicts.
6. Automatic tests (CI) pass. Preview-deploy checks (Vercel, Netlify, Cloudflare Pages, Render) are ignored.
7. The AI review (Gemini, or Claude as backup) approves the change and confirms it solves the issue.
8. The maintainer turned auto-merge on (`/config auto_merge value:on`). It is **off** by default.

Draft PRs are never reviewed.

## Cost

You use your own Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). Google offers a free tier with daily limits and paid usage beyond that; check [Google's pricing page](https://ai.google.dev/pricing) for current numbers, since they change.

Optionally add an Anthropic API key as a backup. It is only used when Gemini returns a rate-limit, quota, or overload error, or times out; you pay Anthropic only for those reviews.

To keep usage low, the AI is called **at most once per commit**. PRs that fail the basic checks (no linked issue, not assigned, dependency or scope problems) never call Gemini at all.

The bot itself runs on the Cloudflare Workers free tier.

## Slash commands

| Command | What it does |
|---|---|
| `/help` | How AutoMerge works and how to set it up. |
| `/status` | Your setup checklist and what to do next. |
| `/setup gemini_api_key:<key> [anthropic_api_key:<key>]` | Step 1: save your Gemini API key, plus an optional Anthropic backup key. Keys are checked, then encrypted. |
| `/connect` | Step 2: get the link to install AutoMerge on your GitHub repo. |
| `/repo add slug:<link>` | Start watching a repo. Paste its GitHub link. |
| `/repo remove slug:<link>` | Stop watching a repo. |
| `/repo list` | See which repos AutoMerge watches. |
| `/check slug:<PR link>` | Review a PR right now and see the result in Discord. |
| `/config auto_merge value:<on\|off>` | Let AutoMerge merge PRs that pass every check. |
| `/config strategy value:<squash\|merge\|rebase>` | How PRs are merged. Squash is recommended. |
| `/on` and `/off` | Resume or pause AutoMerge. |
| `/watch_claims channel:<#channel> repo:<link>` | Let people claim issues by posting the number in a channel. |
| `/link_github` | Contributors connect their GitHub account so they can claim issues. |

## Architecture

```
Discord slash command        GitHub App webhook        Cron (every minute)
        |                           |                          |
        v                           v                          v
+--------------------------------------------------------------------+
|                  Cloudflare Worker (this repo)                     |
|   Hono router -> command handlers / reviewer / issue-claim poller  |
+-------------+--------------------------------------+---------------+
              |                                      |
              v                                      v
     Cloudflare D1 (SQLite)          Gemini API (main) -> Claude API (backup)
  (settings, repo list, PR state,
   cached review per commit)
```

## Security

* **API keys (Gemini and the optional Anthropic backup) are checked, then encrypted at rest** (AES-GCM, random 96-bit IV). The plain key exists in memory only during a review.
* **Discord interactions are verified** with ed25519, **GitHub webhooks** with HMAC-SHA256.
* **GitHub installation tokens** are short-lived (about 1 hour) and kept only in the Worker's memory.
* **Contributor code is never run or checked out.** AutoMerge reads diffs through the GitHub API.
* **What is stored:** your settings, the repos you watch, and each PR's latest review result (verdict, summary, and fix list) so the same commit is never reviewed twice. Review results expire after 30 days. Diffs, code, and issue text are not stored.
* **Prompt-injection guard:** PR text and diffs are passed to Gemini as untrusted data, and an "approve" that still lists blocking problems is overridden to "changes needed".

## Self-host

1. `pnpm install`
2. Create your own Discord app, GitHub App, and (for issue claims) a GitHub OAuth App.
3. `npx wrangler d1 create automerge`, paste the id into `wrangler.toml`, then `npx wrangler d1 execute automerge --remote --file=migrations/0001_initial.sql`.
4. Set the secrets with `wrangler secret put`. The full list is in `.env.example`.
5. `pnpm register-commands`
6. `pnpm deploy`

Optional: set `GEMINI_MODEL` and `ANTHROPIC_MODEL` in `wrangler.toml` `[vars]` to change models (defaults `gemini-3.8-flash` and `claude-haiku-4-5`).

## License

MIT. See [LICENSE](./LICENSE).
