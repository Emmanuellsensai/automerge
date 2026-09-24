# Install AutoMerge

AutoMerge is a Discord bot and GitHub App that reads every pull request opened on your repository, cross-references it against the linked issue, checks CI, and either posts review feedback or squash-merges the PR when it is clean. Reviews run on Claude Haiku 4.5, paid by your Anthropic API key.

**Time to set up: about 5 minutes.**

## What you need

* **A Discord server you own** (or a channel where you can invite the bot).
* **The GitHub repo or org you want managed.** You must be an **Owner** on a personal repo or an **Admin** on an org.
* **An Anthropic API key.** Get one at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). Cost is about **$0.007 per PR review**. Mechanical rejections cost $0. $5 is enough for hundreds of reviews.

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
| `/watch_claims channel:<#chan> repo:<owner/repo>` | Watch a channel for issue claims. |
| `/link_github` | Contributor: link your GitHub login to your Discord id. |
| `/help` | Show the command list. |

## The strict gate rule

AutoMerge merges a PR only when **all** of these are true. Cheaper mechanical gates are checked first, so bad PRs never call Claude.

### Mechanical gates (no Claude spend)

1. **Linked issue exists** (`Closes #N` in the PR body) and the bot can read it.
2. **PR author is an official assignee** of the linked issue.
3. **No dependency-manifest changes.** `package.json`, `pnpm-lock.yaml`, `go.mod`, `Cargo.toml`, `requirements.txt`, and eight other manifest files are treated as policy decisions and always need a human.
4. **Every changed file is in scope.** File paths named in backticks inside the linked issue body are the scope. Tests (`*_test.go`, `*.test.ts`, `*.spec.tsx`, etc.) and docs (`docs/*`, `*.md`) are always allowed.
5. **CI on the head commit is passing.** Missing, pending, or failing blocks the merge. Preview-deployment checks (Vercel, Netlify, Cloudflare Pages, Render) are ignored because they gate on maintainer approval, not code.

### Claude review (one call per commit SHA)

6. **Claude verdict is `approve`.** Not `request_changes` or `comment`.
7. **Claude confirms the PR addresses the linked issue.**

Claude is called **once per commit SHA** and the verdict is cached. Later webhooks on the same commit (CI settling, workflow completions) reuse the cached verdict and cost $0.

### Configuration gate

8. **Maintainer has `/config auto_merge value:on`.**

**Drafts are never approved.** PRs with no `Closes #N` reference are automatically flagged.

## What contributors see

**One deduped comment per PR.** AutoMerge posts one comment on the first review and edits that same comment on every subsequent update. Contributors never see a wall of stale reviews.

The comment always tells contributors exactly what to fix, in order:

* **Missing linked issue** or **not assigned** — one terse note explaining the gate.
* **Touches a dependency manifest** or **out of scope** — the exact blocking condition and which files triggered it.
* **CI failing** — wait note.
* **All gates green** — a friendly review from Claude, followed by an automatic squash-merge.

## Auto-approving first-time contributor workflows

Public GitHub repos gate first-time contributors' workflow runs behind a maintainer click. AutoMerge auto-approves those runs when the contributor is an assignee of the linked issue, so real code CI can execute without you clicking anything.

Grant the GitHub App **Actions: Read and write** permission for this to work. If you installed AutoMerge before this feature shipped, do it now:

1. Go to `https://github.com/settings/apps/automerge-wave/permissions`. Change **Actions** to **Read and write**. Save.
2. Go to `https://github.com/settings/installations`. Click **Configure** on AutoMerge-wave. Click **Accept new permissions** at the top.

## Issue claims from Discord (optional)

If your project also uses Discord to coordinate who works on what issue, AutoMerge can auto-assign issues on a first-come-first-served basis when someone claims one in a chat channel.

### Maintainer setup

1. Create a GitHub OAuth App (separate from the GitHub App used for reviews):
   * Go to `https://github.com/settings/developers` and click **New OAuth App**.
   * Authorization callback URL: `https://automerge.automergewave.workers.dev/github/oauth/callback`.
   * Save. Copy the client id and generate a client secret.
2. Register both with the Worker:
   ```
   wrangler secret put GITHUB_OAUTH_CLIENT_ID
   wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
   ```
3. Pick a channel in Discord where contributors will claim issues and get its channel id (right-click the channel with Developer Mode on).
4. In any channel the bot can post in:
   ```
   /watch_claims channel:#your-channel repo:owner/repo
   ```

### Contributor flow

Every contributor runs `/link_github` once. That opens a GitHub OAuth prompt, and the bot records their Discord id -> GitHub login. After that, whenever they post `#42` or a full issue URL in the watched channel, AutoMerge will:

* Fetch the issue.
* If unassigned, assign the author's linked login and react with a checkmark.
* If already claimed, react with a no-entry sign and record the state (so the channel scan is O(new-messages), not O(total-messages)).

### How the poll works

A Cloudflare cron trigger fires once per minute. Each tick fetches new messages from every watched channel using the last-seen message id as an `after` cursor. This runs on the Workers free tier.

### Limits and caveats

* The GitHub App installation needs **Issues: Read and write** on the repo, otherwise assignment will fail with 422.
* Only accounts that are collaborators of the repo (or org members with issue access) can be assigned. Attempted claims by unlinked or unauthorized users still get a reaction but no state is stored, so they can retry after being invited.
* Bare `#N` matches inherit the channel's watched repo. Full URLs are only followed when they point to that same repo.

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

### Bot posts one comment then never updates it

That is the intended behavior. The comment is edited in place on every re-run to keep the PR page clean. Refresh the PR to see the latest text.

### "Auto-merge attempted but got: 405 Method Not Allowed."

The GitHub App installation does not have write access to Contents. Reinstall on the repo and grant the requested permissions.

### First-time contributor workflows still need manual approval

The Actions permission was not granted. See "Auto-approving first-time contributor workflows" above.

### Bot merged the wrong PR

Turn auto-merge off immediately:

```
/off
/config auto_merge value:off
```

Then open an issue on [Emmanuellsensai/automerge](https://github.com/Emmanuellsensai/automerge/issues) with the PR link.

## Cost

Each review calls Claude Haiku 4.5 **once per commit SHA** with the PR diff (capped at 8k characters) plus prompt. Later webhooks on the same commit are free.

* **Typical cost per merged PR:** about $0.007.
* **Mechanical rejections (missing assignee, out of scope, dep changes):** $0.
* **$1 covers roughly 150 reviews.**

You pay only for your own API usage. The bot's Cloudflare Worker and KV run on the free tier.

## Privacy and security

* **Your Anthropic API key is encrypted** with AES-GCM before being stored in Cloudflare KV. It is decrypted only in memory at the moment a review runs.
* **GitHub App installation tokens** are minted per request and never cached.
* **PR code is never checked out.** AutoMerge inspects diffs through the GitHub API only.
* **Discord webhook signatures** are verified via ed25519 on every interaction.
* **GitHub webhook signatures** are verified via HMAC-SHA256 on every event.
* **No PR content, diff, or issue body** is stored on the server past the duration of a single review.
* **Source code:** [github.com/Emmanuellsensai/automerge](https://github.com/Emmanuellsensai/automerge).
