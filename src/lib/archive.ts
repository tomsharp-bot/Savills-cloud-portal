export const ARCHIVE_BOARD_LIMIT = 5;

export function recentArchived<T extends { updatedAt: Date }>(
  projects: T[],
  limit = ARCHIVE_BOARD_LIMIT
): T[] {
  return [...projects]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
}

export function sortArchived<T extends { name: string; projectManager: string; updatedAt: Date }>(
  projects: T[],
  key: "name" | "projectManager" | "updatedAt" = "updatedAt",
  dir: "asc" | "desc" = "desc"
): T[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...projects].sort((a, b) => {
    if (key === "updatedAt") {
      return (a.updatedAt.getTime() - b.updatedAt.getTime()) * mul;
    }
    return String(a[key] || "").localeCompare(String(b[key] || ""), "en-GB") * mul;
  });
}
