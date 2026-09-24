// Registers global slash commands with Discord.
// Run once (and again whenever commands change): pnpm register-commands
// Reads DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN from .dev.vars or the process env.

import { readFileSync, existsSync } from "node:fs";

const commands = [
  {
    name: "setup",
    description: "Save your Anthropic API key (encrypted).",
    options: [
      { name: "anthropic_api_key", description: "Your Anthropic API key", type: 3, required: true },
    ],
  },
  {
    name: "connect",
    description: "Install the AutoMerge GitHub App and pick repos to manage.",
  },
  {
    name: "repo",
    description: "Manage tracked repos.",
    options: [
      {
        type: 1, name: "add", description: "Start managing a repo",
        options: [{ name: "slug", description: "owner/repo", type: 3, required: true }],
      },
      {
        type: 1, name: "remove", description: "Stop managing a repo",
        options: [{ name: "slug", description: "owner/repo", type: 3, required: true }],
      },
      { type: 1, name: "list", description: "Show managed repos" },
    ],
  },
  { name: "on", description: "Resume auto-processing." },
  { name: "off", description: "Pause auto-processing." },
  { name: "status", description: "Show connection and configuration state." },
  {
    name: "check",
    description: "Kick off a review right now.",
    options: [
      { name: "slug", description: "owner/repo", type: 3, required: true },
      { name: "pr", description: "PR number (optional)", type: 4, required: false },
    ],
  },
  {
    name: "config",
    description: "Change AutoMerge settings.",
    options: [
      {
        type: 1, name: "auto_merge", description: "Toggle auto-merge",
        options: [{ name: "value", description: "on|off", type: 3, required: true, choices: [
          { name: "on", value: "on" }, { name: "off", value: "off" },
        ] }],
      },
      {
        type: 1, name: "strategy", description: "Set merge strategy",
        options: [{ name: "value", description: "squash|merge|rebase", type: 3, required: true, choices: [
          { name: "squash", value: "squash" }, { name: "merge", value: "merge" }, { name: "rebase", value: "rebase" },
        ] }],
      },
    ],
  },
  { name: "help", description: "Show the AutoMerge help message." },
  {
    name: "watch_claims",
    description: "Watch a channel for issue claims (FCFS assigns on GitHub).",
    options: [
      { name: "channel", description: "Channel ID to watch", type: 7, required: true },
      { name: "repo", description: "owner/repo whose issues can be claimed here", type: 3, required: true },
    ],
  },
  {
    name: "link_github",
    description: "Link your GitHub account so I can assign issues to you.",
  },
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
