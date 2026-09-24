/**
 * Project overview for /HHSRSreporter/project-overview.
 * Project Progress is the master list: current projects are active, archived projects are completed.
 * HHSRS does not keep a second archive.
 */

import { HHSRS_PROJECT_ROSTER, hhsrsKey, progressNameForCase } from "./hhsrs-reporter-projects.js";

export const PROJECT_PROGRESS_CHANGE_TOAST = "Change this on Project Progress.";

export type OverviewStatus = "Complete" | "In progress";

export type LiveProjectCounts = {
  waiting: number;
  completed: number;
};

export type ProgressProject = {
  name: string;
  stage: string;
};

export type OverviewActiveRow = {
  name: string;
  template: string;
  ratingScheme: string;
  completed: number;
  waiting: number;
  status: OverviewStatus;
};

export type OverviewArchivedRow = {
  name: string;
  completed: number;
};

export type ProjectOverview = {
  active: OverviewActiveRow[];
  archived: OverviewArchivedRow[];
  totals: {
    activeProjects: number;
    waiting: number;
    completed: number;
    archived: number;
  };
};

export function overviewStatus(waiting: number): OverviewStatus {
  return waiting === 0 ? "Complete" : "In progress";
}

function rosterMeta(name: string): { template: string; ratingScheme: string } {
  const key = hhsrsKey(name);
  const row = HHSRS_PROJECT_ROSTER.find(
    (project) => project.name.toLowerCase() === key.toLowerCase() || project.name.toLowerCase() === name.toLowerCase()
  );
  if (!row) return { template: "—", ratingScheme: "—" };
  return { template: row.template, ratingScheme: row.ratingScheme };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "en-GB");
}

/** Attribute submission counts onto Project Progress names, including Colin aliases. */
export function countsByProgressName(
  progressNames: readonly string[],
  liveCounts: Record<string, LiveProjectCounts>
): Map<string, LiveProjectCounts> {
  const buckets = new Map<string, LiveProjectCounts>();
  for (const name of progressNames) buckets.set(name, { waiting: 0, completed: 0 });
  for (const [submissionName, figures] of Object.entries(liveCounts)) {
    const target = progressNameForCase(submissionName, progressNames);
    const bucket = buckets.get(target);
    if (!bucket) continue;
    bucket.waiting += figures.waiting;
    bucket.completed += figures.completed;
  }
  return buckets;
}

export function buildProjectOverview(input: {
  projects: readonly ProgressProject[];
  liveCounts: Record<string, LiveProjectCounts>;
}): ProjectOverview {
  const current = input.projects.filter((project) => project.stage === "current").slice().sort(byName);
  const archivedProjects = input.projects.filter((project) => project.stage === "archive").slice().sort(byName);
  const names = [...current, ...archivedProjects].map((project) => project.name);
  const counts = countsByProgressName(names, input.liveCounts);

  const active: OverviewActiveRow[] = current.map((project) => {
    const figures = counts.get(project.name) || { waiting: 0, completed: 0 };
    const meta = rosterMeta(project.name);
    return {
      name: project.name,
      template: meta.template,
      ratingScheme: meta.ratingScheme,
      completed: figures.completed,
      waiting: figures.waiting,
      status: overviewStatus(figures.waiting),
    };
  });

  const archived: OverviewArchivedRow[] = archivedProjects.map((project) => ({
    name: project.name,
    completed: (counts.get(project.name) || { waiting: 0, completed: 0 }).completed,
  }));

  const waiting = active.reduce((sum, row) => sum + row.waiting, 0);
  const completed =
    active.reduce((sum, row) => sum + row.completed, 0) +
    archived.reduce((sum, row) => sum + row.completed, 0);

  return {
    active,
    archived,
    totals: {
      activeProjects: active.length,
      waiting,
      completed,
      archived: archived.length,
    },
  };
}
