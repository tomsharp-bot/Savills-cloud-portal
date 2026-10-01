import type { ProjectStage } from "@prisma/client";

export type MapPoint = { x: number; y: number };

export type MapProject = {
  id: string;
  name: string;
  stage: ProjectStage;
  mapX: number | null;
  mapY: number | null;
};

/** Current and Upcoming can be pinned. Archive never can. */
export function projectCanBePinned(stage: ProjectStage): boolean {
  return stage === "current" || stage === "upcoming";
}

function readPercent(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function roundPercent(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A point on the outline, as a percentage of the map. Rejects anything off the map. */
export function parseMapPosition(xRaw: unknown, yRaw: unknown): MapPoint | null {
  const x = readPercent(xRaw);
  const y = readPercent(yRaw);
  if (x == null || y == null) return null;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x: roundPercent(x), y: roundPercent(y) };
}

/** Pins already dropped, for projects that are still Current or Upcoming. */
export function mapPinProjects<T extends MapProject>(projects: T[]): T[] {
  return projects.filter(
    (project) =>
      projectCanBePinned(project.stage) && project.mapX != null && project.mapY != null
  );
}

/** Projects an admin can choose when dropping a pin. */
export function mapChoiceProjects<T extends MapProject>(projects: T[]): T[] {
  return projects.filter((project) => projectCanBePinned(project.stage));
}
