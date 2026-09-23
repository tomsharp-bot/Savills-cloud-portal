/**
 * Project overview rows for /HHSRSreporter/project-overview.
 * Colin roster demo counts apply until live submissions exist.
 * Archive overrides persist separately and win over the seed.
 */

import { HHSRS_PROJECT_ROSTER } from "./hhsrs-reporter-projects.js";

export const ARCHIVE_DISABLED_TITLE = "Archive when project is complete.";
export const ARCHIVE_INCOMPLETE_TOAST =
  "Project isn’t complete yet — archive when it is complete.";

export type OverviewStatus = "Complete" | "In progress";

export type LiveProjectCounts = {
  waiting: number;
  completed: number;
};

export type ArchiveOverride = {
  name: string;
  archived: boolean;
  completed: number;
};

export type OverviewActiveRow = {
  name: string;
  template: string;
  ratingScheme: string;
  completed: number;
  waiting: number;
  status: OverviewStatus;
  canArchive: boolean;
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

export function buildProjectOverview(input: {
  hasLiveSubmissions: boolean;
  liveCounts: Record<string, LiveProjectCounts>;
  overrides: ArchiveOverride[];
}): ProjectOverview {
  const overrides = new Map(input.overrides.map((row) => [row.name, row]));
  const known = new Set(HHSRS_PROJECT_ROSTER.map((project) => project.name));

  function archivedNow(name: string, seedArchived: boolean): boolean {
    const override = overrides.get(name);
    if (override) return override.archived;
    return seedArchived;
  }

  function counts(name: string, demoWaiting: number, demoCompleted: number): LiveProjectCounts {
    if (!input.hasLiveSubmissions) {
      return { waiting: demoWaiting, completed: demoCompleted };
    }
    return input.liveCounts[name] || { waiting: 0, completed: 0 };
  }

  const active: OverviewActiveRow[] = [];
  const archived: OverviewArchivedRow[] = [];

  for (const project of HHSRS_PROJECT_ROSTER) {
    const figures = counts(project.name, project.demoWaiting, project.demoCompleted);
    if (archivedNow(project.name, project.seedArchived)) {
      const override = overrides.get(project.name);
      const completed = input.hasLiveSubmissions
        ? figures.completed
        : override?.archived
          ? override.completed || project.demoCompleted
          : project.demoCompleted;
      archived.push({ name: project.name, completed });
      continue;
    }
    const waiting = figures.waiting;
    active.push({
      name: project.name,
      template: project.template,
      ratingScheme: project.ratingScheme,
      completed: figures.completed,
      waiting,
      status: overviewStatus(waiting),
      canArchive: waiting === 0,
    });
  }

  if (input.hasLiveSubmissions) {
    const extras = Object.keys(input.liveCounts)
      .filter((name) => name.trim() && !known.has(name))
      .sort((a, b) => a.localeCompare(b, "en-GB"));
    for (const name of extras) {
      const figures = counts(name, 0, 0);
      if (archivedNow(name, false)) {
        const override = overrides.get(name);
        archived.push({ name, completed: override?.completed || figures.completed });
        continue;
      }
      active.push({
        name,
        template: "—",
        ratingScheme: "—",
        completed: figures.completed,
        waiting: figures.waiting,
        status: overviewStatus(figures.waiting),
        canArchive: figures.waiting === 0,
      });
    }
  }

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
