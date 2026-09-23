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
import { callGemini } from "./gemini";

const DIFF_MAX_CHARS = 60_000;

const PROMPT_HEADER = `You are AutoMerge, a strict but fair PR reviewer for the maintainer of a public open-source repository.
Return ONLY valid JSON matching this schema:
{
  "verdict": "approve" | "request_changes" | "comment",
  "addresses_issue": boolean,
  "ci_ok": boolean,
  "summary": string,
  "issues": string[],
  "suggested_comment": string
}
Rules:
- Approve only if: (a) the PR clearly implements the linked issue's acceptance criteria, (b) CI status you were given is passing, (c) the diff has no obvious correctness, security, or scope problems, (d) it does not silently expand scope beyond the issue.
- If the PR references no issue or the wrong issue, verdict = "request_changes" and say so in issues.
- If CI is failing or missing on the head commit, verdict = "comment" with a wait note.
- Never approve a draft PR.
- The suggested_comment is what the bot will post verbatim. Address the contributor by @login. Be concise and friendly. Cite line numbers or files when raising issues.
`;

function detectLinkedIssue(prBody: string | null, prTitle: string): number | null {
  const text = `${prTitle}\n${prBody ?? ""}`;
  const m = text.match(/(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function ciStatusOn(env: Env, installationId: number, owner: string, repo: string, sha: string) {
  const [status, checks] = await Promise.all([
    getCombinedStatus(env, installationId, owner, repo, sha).catch(() => ({ state: "unknown", total_count: 0 })),
    getCheckRuns(env, installationId, owner, repo, sha).catch(() => ({ total_count: 0, check_runs: [] })),
  ]);
  const anyFailing =
    status.state === "failure" ||
    checks.check_runs.some((c) => c.conclusion === "failure" || c.conclusion === "cancelled" || c.conclusion === "timed_out");
  const anyPending =
    status.state === "pending" ||
    checks.check_runs.some((c) => c.status !== "completed");
  const allPassing =
    (status.state === "success" || status.total_count === 0) &&
    checks.check_runs.every((c) => c.conclusion === "success" || c.conclusion === "neutral" || c.conclusion === "skipped");
  if (anyFailing) return "failing" as const;
  if (anyPending) return "pending" as const;
  if (allPassing && (status.total_count + checks.total_count) > 0) return "passing" as const;
  return "none" as const;
}

export async function reviewPR(
  env: Env,
  args: { owner: string; repo: string; prNumber?: number },
): Promise<void> {
  const repoCfg = await getRepo(env, args.owner, args.repo);
  if (!repoCfg) return;
  const user = await getUser(env, repoCfg.discordUserId);
  if (!user?.enabled || !user.geminiKeyCipher) return;

  const installationId = repoCfg.installationId;
  const prNumbers = args.prNumber
    ? [args.prNumber]
    : (await listOpenPRs(env, installationId, args.owner, args.repo)).map((p) => p.number);

  const apiKey = await decryptSecret(user.geminiKeyCipher, env.ENCRYPTION_KEY);

  for (const n of prNumbers) {
    try {
      const pr = await getPR(env, installationId, args.owner, args.repo, n);
      if (pr.state !== "open" || pr.draft) continue;

      const prev = await getPRState(env, args.owner, args.repo, n);
      // Skip if we've already reviewed this head SHA and it hasn't moved.
      if (prev && prev.lastCommitSha === pr.head.sha && prev.status !== "queued") continue;

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

      const prompt = [
        PROMPT_HEADER,
        `PR: ${args.owner}/${args.repo}#${n} by @${pr.user?.login ?? "unknown"}`,
        `Title: ${pr.title}`,
        `Body:\n${pr.body ?? "(empty)"}`,
        linkedIssue
          ? `Linked issue #${linkedIssue.number}: ${linkedIssue.title}\n${linkedIssue.body ?? ""}\nLabels: ${linkedIssue.labels.map((l) => l.name).join(", ")}`
          : "No linked issue detected.",
        `CI status on ${pr.head.sha}: ${ci}`,
        `Diff:\n${diff}`,
      ].join("\n\n");

      const review = await callGemini(apiKey, prompt);

      // Post the suggested comment (dedupe against last review to avoid spam).
      await commentOnPR(env, installationId, args.owner, args.repo, n, review.suggested_comment);

      if (
        review.verdict === "approve" &&
        review.addresses_issue &&
        ci === "passing" &&
        user.autoMerge
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
