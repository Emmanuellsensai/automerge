# Install AutoMerge

AutoMerge is a Discord bot and GitHub App that reads every pull request opened on your repository, cross-references it against the linked issue, checks CI, and either posts review feedback or squash-merges the PR when it is clean. Reviews run on Claude Haiku 4.5, paid by your Anthropic API key.

**Time to set up: about 5 minutes.**

## What you need

* **A Discord server you own** (or a channel where you can invite the bot).
* **The GitHub repo or org you want managed.** You must be an **Owner** on a personal repo or an **Admin** on an org.
* **An Anthropic API key.** Get one at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). Cost is about **$0.007 per PR review**. $5 is enough for hundreds of reviews.

## 1. Add the bot to your Discord server

Open the invite link:

> **[Install AutoMerge on Discord](https://discord.com/oauth2/authorize?client_id=1552301499139493888&scope=applications.commands+bot)**

Discord will ask you to pick a server. Click **Authorize**. That is it. No permissions to configure.

## 2. Install the GitHub App on your repo

Open:

> **[Install AutoMerge on GitHub](https://github.com/apps/automerge-wave)**

Click **Install** at the top-right. On the next screen:

* **Choose the account.** Your personal account, or the org that owns the repo.
* **Only select repositories.** Tick the repos you want managed. You can add more later.
* Click **Install**.

You will bounce back to `github.com/settings/installations` showing the installation. Done.

## 3. Give the bot your Anthropic API key

In your Discord server, in any channel where the bot can post:

```
/setup anthropic_api_key:sk-ant-api03-...
```

Get the key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). Anthropic keys start with `sk-ant-`. Enable billing on your Anthropic account (or use the free credit) so the key can actually make calls.

**The key is encrypted with AES-GCM before being stored.** It is used only to review your PRs.

## 4. Tell AutoMerge which repos to manage

```
/repo add slug:<owner>/<repo>
```

Repeat for every repo you want managed. Verify:

```
/status
```

You should see:

```
AutoMerge status
- Anthropic key: linked
- GitHub installation: #12345
- Processing: on
- Auto-merge: on
- Managed repos: 1
  * yourname/yourrepo
```

## 5. Turn on real auto-merge (optional)

By default AutoMerge reviews and comments but does not merge. When you are ready:

```
/config auto_merge value:on
```

Now, whenever a PR meets **all** these conditions, AutoMerge squash-merges it:

1. **It references an issue** (`Closes #N` in the body).
2. **The PR author is an official assignee** of that issue.
3. **Claude's review verdict is `approve`.** No obvious bugs, addresses the acceptance criteria, no silent scope creep.
4. **CI on the head commit is green.**
5. **The PR is not a draft.**

Everything else gets a review comment explaining what is blocking the merge. Contributors see clear next steps.

Change the merge strategy any time:

```
/config strategy value:squash    # default
/config strategy value:merge
/config strategy value:rebase
```

## Every command

| Command | What it does |
|---|---|
| `/setup anthropic_api_key:<key>` | Save your Anthropic API key (encrypted). |
| `/connect` | Get the GitHub App install link. |
| `/repo add slug:<owner/repo>` | Start managing a repo. |
| `/repo remove slug:<owner/repo>` | Stop managing a repo. |
| `/repo list` | Show managed repos. |
| `/on` and `/off` | Resume or pause automatic processing. |
| `/status` | Show config, installation, and repo count. |
| `/check slug:<owner/repo> [pr:<n>]` | Trigger a review right now. Dry-run friendly. |
| `/config auto_merge value:<on\|off>` | Allow AutoMerge to press Merge. |
| `/config strategy value:<squash\|merge\|rebase>` | How to merge. |
| `/help` | Show the command list. |

## The strict five-gate merge rule

AutoMerge only merges when **all five** of these are true. A single failure blocks the merge and posts a review comment.

1. **Claude verdict is `approve`.** Not `request_changes` or `comment`.
2. **Claude confirms the PR addresses the linked issue.**
3. **CI on the head commit is passing.** Missing, pending, or failing blocks the merge.
4. **Maintainer has `/config auto_merge value:on`.**
5. **PR author is an official assignee of the linked issue.**

Preview-deployment checks (Vercel, Netlify, Cloudflare Pages, Render) are ignored when computing CI state. They gate on maintainer approval, not code quality.

**Drafts are never approved.** PRs with no `Closes #N` reference are automatically flagged.

## Troubleshooting

### "Run `/setup` first. I need an Anthropic API key before connecting GitHub."

You skipped step 3. Paste your key with `/setup`.

### "I cannot see `<owner>/<repo>`. Install the AutoMerge GitHub App on it first."

The App is not installed on that repo. Re-run step 2 and make sure the repo is ticked.

### Bot posts nothing on a PR

Run `/check slug:<owner>/<repo> pr:<n>` in Discord to force a review. Common causes:

* **No `Closes #N` in the PR body.** Bot silently defers.
* **`401 invalid x-api-key`.** Re-check your key with `/setup`, then `/status`.
* **CI is still pending.** Bot will not merge until it settles.

### "Auto-merge attempted but got: 405 Method Not Allowed."

The GitHub App installation does not have write access to Contents. Reinstall on the repo and grant the requested permissions.

### Bot merged the wrong PR

Turn auto-merge off immediately:

```
/off
/config auto_merge value:off
```

Then open an issue on [Emmanuellsensai/automerge](https://github.com/Emmanuellsensai/automerge/issues) with the PR link.

## Cost

Each review calls Claude Haiku 4.5 once with the PR diff (capped at 8k characters) plus prompt. **Typical cost per review is about $0.007. $1 covers roughly 150 reviews.**

You pay only for your own API usage. The bot's Cloudflare Worker and KV run on the free tier.

## Privacy and security

* **Your Anthropic API key is encrypted** with AES-GCM before being stored in Cloudflare KV. It is decrypted only in memory at the moment a review runs.
* **GitHub App installation tokens** are minted per request and never cached.
* **Discord webhook signatures** are verified via ed25519 on every interaction.
* **GitHub webhook signatures** are verified via HMAC-SHA256 on every event.
* **No PR content, diff, or issue body** is stored on the server past the duration of a single review.
* **Source code:** [github.com/Emmanuellsensai/automerge](https://github.com/Emmanuellsensai/automerge).
