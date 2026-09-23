/** Short hazard line for the new-pending toast and desktop notification. */
export function pendingAlertSummary(input: {
  category: string;
  rating: string;
  comment: string;
}): string {
  const comment = input.comment.replace(/\s+/g, " ").trim();
  const short = comment.length > 140 ? `${comment.slice(0, 137)}...` : comment;
  const head = [input.category, input.rating]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
  if (head && short) return `${head} — ${short}`;
  return head || short;
}

/** Pending rows whose ids were not in the previous snapshot. Order is preserved. */
export function newPendingAlerts<T extends { id: string }>(
  seenIds: readonly string[],
  pending: readonly T[]
): T[] {
  const seen = new Set(seenIds);
  return pending.filter((item) => item.id && !seen.has(item.id));
}
