// The status line of the bot's PR comment: its first "### " heading. No imports, so it can be tested.
export function commentHeadline(body: string | null | undefined): string {
  const line = (body ?? "").split("\n").find((l) => l.startsWith("### "));
  return line ? line.slice(4).trim() : "";
}

// A status change is worth a fresh comment (GitHub notifies nobody about an edit).
export function statusChanged(oldBody: string | null | undefined, newBody: string): boolean {
  return commentHeadline(oldBody) !== commentHeadline(newBody);
}
