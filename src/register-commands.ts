// Registers global slash commands with Discord.
// Run once (and again whenever commands change): pnpm register-commands
// Reads DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN from .dev.vars or the process env.

import { readFileSync, existsSync } from "node:fs";

const commands = [
  {
    name: "setup",
    description: "Step 1: save your Gemini API key (free from aistudio.google.com/apikey).",
    options: [
      { name: "gemini_api_key", description: "Paste your Gemini API key here", type: 3, required: true },
    ],
  },
  { name: "connect", description: "Step 2: get the link to install AutoMerge on your GitHub repo." },
  {
    name: "repo",
    description: "Choose which GitHub repos AutoMerge looks after.",
    options: [
      {
        type: 1, name: "add", description: "Start watching a repo",
        options: [{ name: "slug", description: "Paste the repo's GitHub link, or type owner/repo", type: 3, required: true }],
      },
      {
        type: 1, name: "remove", description: "Stop watching a repo",
        options: [{ name: "slug", description: "Paste the repo's GitHub link, or type owner/repo", type: 3, required: true }],
      },
      { type: 1, name: "list", description: "Show the repos AutoMerge watches" },
    ],
  },
  { name: "on", description: "Turn AutoMerge back on." },
  { name: "off", description: "Pause AutoMerge. Nothing gets reviewed or merged until /on." },
  { name: "status", description: "See your setup checklist and what to do next." },
  {
    name: "check",
    description: "Review a pull request right now.",
    options: [
      { name: "slug", description: "Paste the PR link, or the repo link / owner/repo", type: 3, required: true },
      { name: "pr", description: "PR number (not needed if you pasted a PR link)", type: 4, required: false },
    ],
  },
  {
    name: "config",
    description: "Change how AutoMerge behaves.",
    options: [
      {
        type: 1, name: "auto_merge", description: "Let AutoMerge merge PRs that pass every check",
        options: [{ name: "value", description: "on or off", type: 3, required: true, choices: [
          { name: "on (merge PRs that pass)", value: "on" }, { name: "off (only comment)", value: "off" },
        ] }],
      },
      {
        type: 1, name: "strategy", description: "Choose how PRs are merged",
        options: [{ name: "value", description: "squash is recommended", type: 3, required: true, choices: [
          { name: "squash (recommended)", value: "squash" }, { name: "merge", value: "merge" }, { name: "rebase", value: "rebase" },
        ] }],
      },
    ],
  },
  { name: "help", description: "How AutoMerge works and how to set it up." },
  {
    name: "watch_claims",
    description: "Let people claim GitHub issues by posting the issue number in a channel.",
    options: [
      { name: "channel", description: "The channel where people claim issues", type: 7, required: true },
      { name: "repo", description: "Paste the repo's GitHub link, or type owner/repo", type: 3, required: true },
    ],
  },
  { name: "link_github", description: "Connect your GitHub account so you can claim issues." },
];

function loadDevVars(): void {
  if (!existsSync(".dev.vars")) return;
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
}

async function main() {
  loadDevVars();
  const app = process.env.DISCORD_APPLICATION_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!app || !token) throw new Error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN required");

  const res = await fetch(`https://discord.com/api/v10/applications/${app}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  console.log(`registered ${commands.length} global commands`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
