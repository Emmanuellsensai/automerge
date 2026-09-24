import type { Env } from "../index";
import {
  approveWorkflowRun,
  commentOnPR,
  getCheckRuns,
  getCombinedStatus,
  getIssue,
  getPR,
  getPRDiff,
  listOpenPRs,
  listPRFiles,
  listWorkflowRunsAwaitingApproval,
  mergePR,
  upsertMarkedComment,
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

// A single dedupe marker on every bot comment so we edit instead of piling up.
const COMMENT_MARKER = "<!-- automerge-gate -->";

// Dependency manifests. A PR that touches any of these needs human review, since
// a new dependency is a policy decision, not just a code change.
const DEPENDENCY_MANIFESTS = [
  /^package\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)package-lock\.json$/i,
  /^go\.mod$/i,
  /^go\.sum$/i,
  /^Cargo\.toml$/i,
  /^Cargo\.lock$/i,
  /^requirements(-.*)?\.txt$/i,
  /^Pipfile(\.lock)?$/i,
  /^poetry\.lock$/i,
  /^pyproject\.toml$/i,
  /^Gemfile(\.lock)?$/i,
  /^composer\.(json|lock)$/i,
];

function touchesDependencyManifest(files: { filename: string }[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (DEPENDENCY_MANIFESTS.some((r) => r.test(f.filename))) hits.push(f.filename);
  }
  return hits;
}

// Extract file / directory paths named in backticks in the issue body.
// e.g. `apps/api/handler.go`, `route/route.go`, `docs/`.
function extractIssueScopePaths(issueBody: string | null): string[] {
  if (!issueBody) return [];
  const raw = issueBody.match(/`[a-zA-Z0-9_./\-]+`/g) ?? [];
  return Array.from(
    new Set(
      raw
        .map((t) => t.replace(/`/g, "").replace(/\/+$/, ""))
        .filter((p) => /\//.test(p) || /\.(go|ts|tsx|js|jsx|py|rs|md|ya?ml|json|sql|toml|sh)$/i.test(p)),
    ),
  );
}

// A changed file is in scope if it matches one of the named paths exactly, or is a descendant.
// Test files and docs accompanying in-scope work are always allowed.
function outOfScopeFiles(
  changed: { filename: string; status: string }[],
  scope: string[],
): string[] {
  if (scope.length === 0) return [];
  const outside: string[] = [];
  for (const f of changed) {
    if (/(_test\.(go|py|ts|tsx|js|jsx|rs))$|(\.test\.(ts|tsx|js|jsx))$|\.spec\.(ts|tsx|js|jsx)$/.test(f.filename)) continue;
    if (/^docs?\//i.test(f.filename) || /\.md$/i.test(f.filename)) continue;
    const inScope = scope.some((p) => f.filename === p || f.filename.startsWith(p + "/"));
    if (!inScope) outside.push(f.filename);
  }
  return outside;
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
      // Skip if we've already reviewed this head SHA and there's nothing left to do.
      // Re-enter when the state is "queued" (waiting for CI) OR when Claude previously said
      // "approve" but we haven't merged yet — a later webhook may bring green CI.
      if (
        !args.force &&
        prev &&
        prev.lastCommitSha === pr.head.sha &&
        prev.status !== "queued" &&
        !(prev.cachedVerdict === "approve" && prev.status !== "merged")
      ) {
        continue;
      }

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

      // Cheap gates before spending Claude tokens.
      // 1) No linked issue: post one terse note (deduped), skip Claude.
      // 2) Linked issue has no assignees, or PR author is not an assignee: post one terse note (deduped), skip Claude.
      const prAuthorLogin = pr.user?.login ?? "unknown";
      const prAuthor = prAuthorLogin.toLowerCase();
      const assignees = (linkedIssue?.assignees ?? []).map((a) => a.login.toLowerCase());
      const isAssigned = !!linkedIssue && assignees.includes(prAuthor);

      const skipNote = !linkedIssueN
        ? `AutoMerge: this PR does not reference an issue (\`Closes #N\`). Please add a reference so I can gate the merge.`
        : !linkedIssue
        ? `AutoMerge: I could not read issue #${linkedIssueN}. Make sure it exists and the App has access.`
        : assignees.length === 0
        ? `AutoMerge: issue #${linkedIssue.number} has no assignee. Only an assigned contributor's PR is eligible for auto-merge.`
        : !isAssigned
        ? `AutoMerge: issue #${linkedIssue.number} is assigned to ${assignees.map((a) => "@" + a).join(", ")}, but this PR was opened by @${prAuthorLogin}. Only the assigned contributor's PR is eligible for auto-merge.`
        : null;

      if (skipNote) {
        await upsertMarkedComment(env, installationId, args.owner, args.repo, n, COMMENT_MARKER, skipNote);
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: "skipped",
          lastReviewAt: new Date().toISOString(),
          message: skipNote,
        });
        continue;
      }

      // Cheap gates that don't need Claude — run before the diff fetch and LLM call.
      const changedFiles = await listPRFiles(env, installationId, args.owner, args.repo, n);
      const depHits = touchesDependencyManifest(changedFiles);
      const scope = extractIssueScopePaths(linkedIssue?.body ?? null);
      const outside = outOfScopeFiles(changedFiles, scope);

      const mechanicalBlockers: string[] = [];
      if (depHits.length > 0) {
        mechanicalBlockers.push(
          `**New / changed dependency manifest** (${depHits.map((f) => "`" + f + "`").join(", ")}). A new dependency is a policy decision and needs a human review.`,
        );
      }
      if (scope.length > 0 && outside.length > 0) {
        mechanicalBlockers.push(
          `**Out of scope for issue #${linkedIssue!.number}.** The issue names \`${scope.join("`, `")}\` but the PR also touches: ${outside.slice(0, 8).map((f) => "`" + f + "`").join(", ")}${outside.length > 8 ? ` and ${outside.length - 8} more` : ""}.`,
        );
      }

      if (mechanicalBlockers.length > 0) {
        const msg = [
          `AutoMerge: this PR won't auto-merge until the following are addressed:`,
          ...mechanicalBlockers.map((b, i) => `${i + 1}. ${b}`),
          ``,
          `_All other gates (assignment, CI, review) still apply once these are resolved._`,
        ].join("\n");
        await upsertMarkedComment(env, installationId, args.owner, args.repo, n, COMMENT_MARKER, msg);
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: "skipped",
          lastReviewAt: new Date().toISOString(),
          message: msg,
        });
        continue;
      }

      // Assigned contributor: auto-approve any workflows that are waiting on maintainer approval,
      // so first-time contributors' CI can actually run.
      const pending = await listWorkflowRunsAwaitingApproval(env, installationId, args.owner, args.repo, pr.head.sha);
      for (const run of pending) {
        await approveWorkflowRun(env, installationId, args.owner, args.repo, run.id).catch((e) => {
          console.error(`approveWorkflowRun failed on ${args.owner}/${args.repo} run=${run.id}`, e);
        });
      }
      if (pending.length > 0) {
        // Workflows just started; wait for the next webhook to review with real CI.
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: "pending",
          status: "queued",
          lastReviewAt: new Date().toISOString(),
          message: `approved ${pending.length} workflow run(s), waiting for CI`,
        });
        continue;
      }

      // Reuse a cached Claude verdict when the SHA hasn't moved. This is the key cost saver:
      // if we already reviewed this commit and CI just resolved on a later webhook, we skip Claude.
      let verdict: "approve" | "request_changes" | "comment";
      let addressesIssue: boolean;
      let summary: string;
      let commentBody: string | null;
      const sameSha = !!prev && prev.lastCommitSha === pr.head.sha && !!prev.cachedVerdict;
      if (sameSha) {
        verdict = prev!.cachedVerdict!;
        addressesIssue = prev!.cachedAddressesIssue === true;
        summary = prev!.message ?? "";
        commentBody = null; // already posted for this SHA
      } else {
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
        verdict = review.verdict;
        addressesIssue = review.addresses_issue;
        summary = review.summary;
        commentBody = review.suggested_comment;
      }

      // Post the review comment once per SHA. Later webhooks reuse the cache and skip posting.
      if (commentBody) {
        await upsertMarkedComment(env, installationId, args.owner, args.repo, n, COMMENT_MARKER, commentBody);
      }

      const ciAcceptable = ci === "passing" || ci === "none";
      if (verdict === "approve" && addressesIssue && ciAcceptable && user.autoMerge) {
        await mergePR(env, installationId, args.owner, args.repo, n, user.mergeStrategy, pr.head.sha).catch(async (e) => {
          await upsertMarkedComment(
            env,
            installationId,
            args.owner,
            args.repo,
            n,
            COMMENT_MARKER,
            `AutoMerge attempted to merge but got: \`${(e as Error).message}\`.`,
          );
        });
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: "merged",
          lastReviewAt: new Date().toISOString(),
          message: summary,
          cachedVerdict: verdict,
          cachedAddressesIssue: addressesIssue,
          cachedCommentPosted: true,
        });
      } else if (verdict === "approve" && addressesIssue && !ciAcceptable) {
        // Claude approved but CI hasn't settled yet — hold and wait for the next webhook,
        // which will re-enter and (with cached verdict) merge without a second Claude call.
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: "queued",
          lastReviewAt: new Date().toISOString(),
          message: summary,
          cachedVerdict: verdict,
          cachedAddressesIssue: addressesIssue,
          cachedCommentPosted: commentBody === null ? prev?.cachedCommentPosted === true : true,
        });
      } else {
        await putPRState(env, args.owner, args.repo, n, {
          lastCommitSha: pr.head.sha,
          lastCiConclusion: ci,
          status: verdict === "approve" ? "reviewed" : "commented",
          lastReviewAt: new Date().toISOString(),
          message: summary,
          cachedVerdict: verdict,
          cachedAddressesIssue: addressesIssue,
          cachedCommentPosted: commentBody === null ? prev?.cachedCommentPosted === true : true,
        });
      }
    } catch (e) {
      // Non-fatal: log-only. In production wire this to a logging sink.
      console.error(`review failed on ${args.owner}/${args.repo}#${n}`, e);
    }
  }
}
