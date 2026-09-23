import { ephemeral } from "../interactions";

export function runHelp() {
  return ephemeral(
    [
      "**AutoMerge** — auto-reviews and auto-merges PRs on your GitHub repos using Gemini.",
      "",
      "`/setup` — one-time setup: paste your Gemini API key",
      "`/connect` — install the GitHub App on the repos you want managed",
      "`/repo add <owner/repo>` — start managing a repo",
      "`/repo remove <owner/repo>` — stop managing a repo",
      "`/repo list` — show managed repos",
      "`/on` / `/off` — enable / pause auto-processing",
      "`/status` — connection status and per-repo state",
      "`/check <owner/repo> [pr]` — trigger a review right now",
      "`/config auto_merge <on|off>` — allow AutoMerge to press Merge",
      "`/config strategy <squash|merge|rebase>` — how to merge",
      "`/help` — this list",
    ].join("\n"),
  );
}
