import { ephemeral } from "../interactions";

export function runHelp() {
  return ephemeral(
    [
      "**AutoMerge** reads every pull request (PR) on your GitHub repo, checks it with Google Gemini, and tells the contributor exactly what to fix. When a PR passes every check, it can merge it for you.",
      "",
      "**Set it up in 3 steps (about 5 minutes)**",
      "1. `/setup` and paste a Gemini API key. Get a free one at <https://aistudio.google.com/apikey> (sign in, click **Create API key**, copy it).",
      "2. `/connect`, open the link, tick your repo, press **Install**. Then `/repo add` and paste your repo's GitHub link.",
      "3. Optional: `/config auto_merge value:on` so AutoMerge merges PRs that pass. Until then it only comments.",
      "",
      "Run `/status` any time to see what's done and what's next.",
      "",
      "**Everyday commands**",
      "`/status` see your setup checklist and settings",
      "`/check` review a PR right now (paste the PR link)",
      "`/off` pause AutoMerge, `/on` resume it",
      "`/repo list` see which repos AutoMerge watches, `/repo remove` stop watching one",
      "`/config strategy` choose how PRs are merged (squash is recommended)",
      "",
      "**Issue claims (optional)**",
      "`/watch_claims` pick a channel where people claim issues. The first person to post an issue number or link gets assigned on GitHub.",
      "`/link_github` contributors run this once so AutoMerge knows their GitHub account.",
    ].join("\n"),
  );
}
