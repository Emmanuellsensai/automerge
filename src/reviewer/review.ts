import type { Env } from "../index";
import {
  commentOnPR,
  getCheckRuns,
  getCombinedStatus,
  getIssue,
  getPR,
  getPRDiff,
  listOpenPRs,
  mergePR,
} from "../github/api";
import { getPRState, getRepo, getUser, putPRState } from "../kv/config";
import { decryptSecret } from "../kv/crypto";
import { callClaude } from "./claude";

const DIFF_MAX_CHARS = 8_000;

const SYSTEM_PROMPT = `You are AutoMerge, a strict but fair PR reviewer for the maintainer of a public open-source repository.
Return ONLY valid JSON (no prose, no code fences) matching this schema:
{
  "verdict": "approve" | "request_changes" | "comment",
  "addresses_issue": boolean,
  "ci_ok": boolean,
  "summary": string,
  "issues": string[],
  "suggested_comment": string
}
Rules:
- Approve only if: (a) the PR clearly implements the linked issue's acceptance criteria, (b) CI status you were given is passing, (c) the diff has no obvious correctness, security, or scope problems, (d) it does not silently expand scope beyond the issue, (e) the PR author is listed among the linked issue's Assignees.
- If the PR author is not among the linked issue's Assignees, verdict = "request_changes" and explicitly state that only the assigned contributor's PR can be merged for that issue.
- If the PR references no issue or the wrong issue, verdict = "request_changes" and say so in issues.
- If CI is failing or missing on the head commit, verdict = "comment" with a wait note.
- Never approve a draft PR.
- The suggested_comment is what the bot will post verbatim. Address the contributor by @login. Be concise and friendly. Cite line numbers or files when raising issues.`;

function detectLinkedIssue(prBody: string | null, prTitle: string): number | null {
  const text = `${prTitle}\n${prBody ?? ""}`;
  const m = text.match(/(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/i);
  return m ? Number(m[1]) : null;
}

// Checks that are gated on maintainer approval, not on code correctness — a "failure" here
// doesn't mean the PR is broken; it means the deployment platform is waiting for a green light.
const IGNORED_CHECK_PATTERNS = [
  /^vercel(\s|$)/i,
  /vercel preview/i,
  /netlify( preview| deploy)?/i,
  /cloudflare pages/i,
  /render( preview| deploy)?/i,
  /deploy preview/i,
];

function isIgnorable(name: string): boolean {
  return IGNORED_CHECK_PATTERNS.some((r) => r.test(name));
}

async function ciStatusOn(env: Env, installationId: number, owner: string, repo: string, sha: string) {
  const [status, checks] = await Promise.all([
    getCombinedStatus(env, installationId, owner, repo, sha).catch(() => ({ state: "unknown", total_count: 0, statuses: [] as { context: string; state: string }[] })),
    getCheckRuns(env, installationId, owner, repo, sha).catch(() => ({ total_count: 0, check_runs: [] })),
  ]);

  const relevantStatuses = (status.statuses ?? []).filter((s) => !isIgnorable(s.context));
  const relevantChecks = checks.check_runs.filter((c) => !isIgnorable(c.name));

  const anyFailing =
    relevantStatuses.some((s) => s.state === "failure" || s.state === "error") ||
    relevantChecks.some((c) => c.conclusion === "failure" || c.conclusion === "cancelled" || c.conclusion === "timed_out");
  const anyPending =
    relevantStatuses.some((s) => s.state === "pending") ||
    relevantChecks.some((c) => c.status !== "completed");
  const anyPassing =
    relevantStatuses.some((s) => s.state === "success") ||
    relevantChecks.some((c) => c.conclusion === "success" || c.conclusion === "neutral" || c.conclusion === "skipped");

  if (anyFailing) return "failing" as const;
  if (anyPending) return "pending" as const;
  if (anyPassing) return "passing" as const;
  return "none" as const;
}

export async function reviewPR(
  env: Env,
  args: { owner: string; repo: string; prNumber?: number; force?: boolean },
): Promise<void> {
  const repoCfg = await getRepo(env, args.owner, args.repo);
  if (!repoCfg) return;
  const user = await getUser(env, repoCfg.discordUserId);
  if (!user?.enabled || !user.anthropicKeyCipher) return;

  const installationId = repoCfg.installationId;
  const prNumbers = args.prNumber
    ? [args.prNumber]
    : (await listOpenPRs(env, installationId, args.owner, args.repo)).map((p) => p.number);

  const apiKey = await decryptSecret(user.anthropicKeyCipher, env.ENCRYPTION_KEY);

  for (const n of prNumbers) {
    try {
      const pr = await getPR(env, installationId, args.owner, args.repo, n);
      if (pr.state !== "open" || pr.draft) continue;

      const prev = await getPRState(env, args.owner, args.repo, n);
      // Skip if we've already reviewed this head SHA and it hasn't moved — unless force is set.
      if (!args.force && prev && prev.lastCommitSha === pr.head.sha && prev.status !== "queued") continue;

      const ci = await ciStatusOn(env, installationId, args.owner, args.repo, pr.head.sha);
      if (ci === "pending") {
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: "queued",
          lastReviewAt: new Date().toISOString(),
          message: "waiting for CI",
        });
        continue;
      }

      const linkedIssueN = detectLinkedIssue(pr.body, pr.title);
      const linkedIssue = linkedIssueN
        ? await getIssue(env, installationId, args.owner, args.repo, linkedIssueN).catch(() => null)
        : null;

      const rawDiff = await getPRDiff(env, installationId, args.owner, args.repo, n);
      const diff = rawDiff.length > DIFF_MAX_CHARS ? rawDiff.slice(0, DIFF_MAX_CHARS) + "\n... [truncated]" : rawDiff;

      const userPrompt = [
        `PR: ${args.owner}/${args.repo}#${n} by @${pr.user?.login ?? "unknown"}`,
        `Title: ${pr.title}`,
        `Body:\n${pr.body ?? "(empty)"}`,
        linkedIssue
          ? [
              `Linked issue #${linkedIssue.number}: ${linkedIssue.title}`,
              `Assignees: ${linkedIssue.assignees.length ? linkedIssue.assignees.map((a) => "@" + a.login).join(", ") : "(none)"}`,
              `Labels: ${linkedIssue.labels.map((l) => l.name).join(", ")}`,
              `Body:\n${linkedIssue.body ?? ""}`,
            ].join("\n")
          : "No linked issue detected.",
        `CI status on ${pr.head.sha}: ${ci}`,
        `Diff:\n${diff}`,
      ].join("\n\n");

      const review = await callClaude(apiKey, SYSTEM_PROMPT, userPrompt);

      // Strict rule: only PRs whose author is an official assignee of the linked issue may be auto-merged.
      const prAuthor = (pr.user?.login ?? "").toLowerCase();
      const assignees = (linkedIssue?.assignees ?? []).map((a) => a.login.toLowerCase());
      const isAssigned = !!linkedIssue && assignees.includes(prAuthor);

      // Compose the comment: reviewer feedback + assignment gate warning when relevant.
      let commentBody = review.suggested_comment;
      if (!linkedIssue) {
        commentBody += "\n\n> AutoMerge: this PR does not reference an issue (`Closes #N`) and will not be auto-merged.";
      } else if (!isAssigned) {
        const list = assignees.length ? assignees.map((a) => `@${a}`).join(", ") : "no one";
        commentBody +=
          `\n\n> AutoMerge: this PR will not be auto-merged. Issue #${linkedIssue.number} is assigned to ${list}, ` +
          `but this PR was opened by @${pr.user?.login}. Only the assigned contributor's PRs are eligible for auto-merge.`;
      }
      await commentOnPR(env, installationId, args.owner, args.repo, n, commentBody);

      if (
        review.verdict === "approve" &&
        review.addresses_issue &&
        ci === "passing" &&
        user.autoMerge &&
        isAssigned
      ) {
        await mergePR(env, installationId, args.owner, args.repo, n, user.mergeStrategy, pr.head.sha).catch(async (e) => {
          await commentOnPR(env, installationId, args.owner, args.repo, n, `AutoMerge attempted to merge but got: \`${(e as Error).message}\`.`);
        });
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: "merged",
          lastReviewAt: new Date().toISOString(),
          message: review.summary,
        });
      } else {
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: review.verdict === "approve" ? "reviewed" : "commented",
          lastReviewAt: new Date().toISOString(),
          message: review.summary,
        });
      }
    } catch (e) {
      // Non-fatal: log-only. In production wire this to a logging sink.
      console.error(`review failed on ${args.owner}/${args.repo}#${n}`, e);
    }
  }
}
