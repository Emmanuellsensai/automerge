# Set up AutoMerge

AutoMerge reads every pull request (PR) on your GitHub repo, checks it with Google Gemini, and posts one comment telling the contributor exactly what to fix. When a PR passes every check, it can merge it for you.

**Time needed: about 5 minutes. No coding.**

## Before you start

You need:

* **A Discord server** where you can add bots (you own it, or you have "Manage Server").
* **A GitHub repo you manage.** You must be the owner of a personal repo, or an admin of an organization's repo.
* **A Google account**, to get a free Gemini API key.

A few words you'll see:

* **Pull request (PR):** someone's proposed change to your code.
* **Issue:** a task or bug report on GitHub. Each PR should say which issue it solves.
* **CI / automatic tests:** the checks GitHub runs on every PR (the green ticks or red crosses).
* **API key:** a password-like code that lets AutoMerge use Gemini on your behalf.

## Step 1: Add the bot to Discord

1. Open **[this invite link](https://discord.com/oauth2/authorize?client_id=1552301499139493888&scope=applications.commands+bot)**.
2. Pick your server and click **Authorize**.

Type `/help` in any channel. If AutoMerge answers, it's in.

## Step 2: Get a Gemini API key

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** and sign in with Google.
2. Click **Create API key** and copy it. It usually starts with `AIza`.
3. In Discord, type `/setup`, paste the key into the box, and press Enter.

AutoMerge checks the key with Google right away. If it says the key isn't valid, copy it again and retry.

Your key is encrypted before it is saved and is only used to review your PRs. Keep it private: don't paste it anywhere else in the chat.

## Step 3: Give AutoMerge access to your repo

1. In Discord, type `/connect` and open the link it gives you.
2. Pick your account or organization.
3. Choose **Only select repositories**, tick the repo(s) you want, and press **Install**.
4. Back in Discord, type `/repo add` and paste your repo's GitHub link (for example `https://github.com/sorolens/sorolens`).

## Step 4: Check everything worked

Type `/status`. You'll see a checklist like this:

```
AutoMerge setup checklist
✅ 1. Gemini API key saved (/setup)
✅ 2. GitHub App installed and repo added (/connect, then /repo add)
⬜ 3. Auto-merge turned on (optional, /config auto_merge)

Next step: you're set up. AutoMerge reviews every PR...
```

That's it. From now on every new PR gets a review comment.

## Step 5 (optional): Let AutoMerge merge PRs

By default AutoMerge **only comments**. It never merges until you allow it:

```
/config auto_merge value:on
```

Turn it off again any time with `/config auto_merge value:off`. To pause AutoMerge completely, type `/off` (and `/on` to resume).

## What contributors see

Each PR gets **one** comment that updates itself on every push. It lists exactly what to do, in order. For example:

> **AutoMerge: changes needed before this can merge**
>
> @xtep103 Close, but a couple of things are off.
>
> **What to do to get this merged:**
>
> 1. **Fix the failing automatic test (CI).** test: 2 tests failed (open the log)
> 2. **The issue asks for something this PR doesn't do yet:** show "No activity" when a contract has no events.
> 3. **`src/contracts.ts:12`: `ledger_closed_at` is parsed as local time.** Fix: use `new Date(row.ledger_closed_at).toISOString()`.

For problems like merge conflicts or extra files, the comment includes the exact commands to copy and paste. A collapsible **Merge gate status** table at the bottom shows which checks passed.

Contributors don't need to ask anyone for a re-review. AutoMerge re-checks on every push and whenever the PR description is edited.

## When does AutoMerge merge a PR?

Only when **all** of these are true:

1. **The PR names its issue.** The description has a line like `Closes #123`.
2. **The PR author is assigned to that issue** on GitHub.
3. **No dependency files changed** (`package.json`, lockfiles, `go.mod`, `Cargo.toml`, `requirements.txt`, and similar). Adding a dependency is a decision for a human.
4. **Only files the issue covers are changed.** If the issue mentions file paths in backticks (like `` `src/api/handler.go` ``), the PR may only change those. Tests and docs are always allowed. If the issue names no paths, this check is skipped.
5. **No merge conflicts.**
6. **Automatic tests (CI) pass.** Preview-deploy checks (Vercel, Netlify, Cloudflare Pages, Render) are ignored.
7. **Gemini approves** and confirms the PR solves the issue.
8. **You turned auto-merge on** (Step 5).

Checks 1 to 4 are free. Gemini is only asked when they pass, and at most once per commit.

**Tip for maintainers:** write file paths in backticks in your issues. It keeps contributors focused and makes check 4 work.

## Every command

| Command | What it does |
|---|---|
| `/help` | How AutoMerge works and how to set it up. |
| `/status` | Your setup checklist and the next step. |
| `/setup` | Save your Gemini API key. |
| `/connect` | Get the link to install AutoMerge on your repo. |
| `/repo add` | Start watching a repo (paste its GitHub link). |
| `/repo remove` | Stop watching a repo. Nothing on GitHub changes. |
| `/repo list` | See which repos AutoMerge watches. |
| `/check` | Review a PR right now. Paste the PR link; the result shows in Discord. |
| `/config auto_merge` | Let AutoMerge merge PRs that pass (on/off). |
| `/config strategy` | How PRs are merged. **Squash** (recommended) turns a PR into one tidy commit. |
| `/on` and `/off` | Resume or pause AutoMerge. |
| `/watch_claims` | Let people claim issues in a Discord channel (see below). |
| `/link_github` | Contributors connect their GitHub account so they can claim issues. |

## Issue claims from Discord (optional)

If people pick issues by posting in Discord ("I'll take #168"), AutoMerge can assign them on GitHub automatically. The first person to post an issue number or link gets it.

**For the maintainer:**

1. Type `/watch_claims`, pick the channel, and paste your repo's GitHub link.

**For each contributor (once):**

1. Type `/link_github` and open the link. Approve on GitHub. This tells AutoMerge which GitHub account is yours.

**What happens when someone posts `#168` or an issue link in that channel:**

* ✅ reaction: the issue was free and is now assigned to them on GitHub.
* ⛔ reaction: someone already has it, or GitHub refused (for example, the person isn't allowed to be assigned in that repo).
* ❓ reaction: they haven't run `/link_github` yet.

AutoMerge checks the channel once a minute, so the reaction can take up to a minute to appear.

**Requirements:** the GitHub App needs **Issues: Read and write** permission. GitHub can refuse to assign someone who has no connection to the repo. If assignment fails, ask the contributor to leave a comment on the issue first and try again.

**Server owners setting this up for the first time** (one-time, technical): create a GitHub OAuth App at `https://github.com/settings/developers` with callback URL `https://automerge.automergewave.workers.dev/github/oauth/callback`, then run `wrangler secret put GITHUB_OAUTH_CLIENT_ID` and `wrangler secret put GITHUB_OAUTH_CLIENT_SECRET`.

## Let first-time contributors' tests run

On public repos, GitHub holds a first-time contributor's tests until a maintainer clicks "Approve and run". AutoMerge clicks it for you when the contributor is assigned to the linked issue.

This needs the **Actions: Read and write** permission. If you installed AutoMerge before this feature existed:

1. Open `https://github.com/settings/apps/automerge-wave/permissions`, set **Actions** to **Read and write**, and save.
2. Open `https://github.com/settings/installations`, click **Configure** next to AutoMerge-wave, and click **Accept new permissions**.

## Troubleshooting

**"Step 1 isn't done yet"**: run `/setup` with your Gemini key first.

**"Google says that key isn't valid"**: copy the key again from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Make sure you copied all of it.

**"I can't see owner/repo yet"**: the GitHub App isn't installed on that repo. Run `/connect` again and make sure the repo is ticked.

**The bot didn't comment on a PR**: type `/check` and paste the PR link. The answer in Discord tells you what happened. Common reasons: the PR is a draft, AutoMerge is paused (`/on`), or the repo isn't added (`/repo list`).

**"Gemini 429" in a review**: you hit Gemini's rate limit or free-tier quota. Wait a bit, or add billing in Google AI Studio.

**"The merge was rejected by GitHub"**: usually branch protection. Check the repo's branch rules, or merge by hand.

**The comment doesn't change**: that's on purpose. AutoMerge edits the same comment each time. Refresh the PR page.

**AutoMerge merged something it shouldn't have**: turn merging off right away with `/config auto_merge value:off` (or `/off` to pause everything), then open an issue at [Emmanuellsensai/automerge](https://github.com/Emmanuellsensai/automerge/issues) with the PR link.

## Privacy and security

* **Your Gemini key is encrypted** (AES-GCM) before it is saved, and decrypted only in memory while a review runs.
* **Contributor code is never run.** AutoMerge only reads the changes through GitHub's API.
* **What is stored:** your settings, the repos you watch, and each PR's latest review result (verdict, summary, and fix list) so the same commit is never reviewed twice. Review results expire after 30 days. Code, diffs, and issue text are not stored.
* **Every message is verified:** Discord messages with ed25519 signatures, GitHub events with HMAC-SHA256.
* **Source code:** [github.com/Emmanuellsensai/automerge](https://github.com/Emmanuellsensai/automerge).
