/** Surveyor project boxes on Personnel. One project per box, five boxes. */
export const SURVEYOR_PROJECT_SLOTS = 5;

type StagedProject = {
  stage: string;
  createdAt: Date;
};

function byCreatedAt(a: StagedProject, b: StagedProject): number {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Projects a surveyor may be assigned on Personnel.
 * Current, then Upcoming, each in the created order Project Progress already uses.
 * Archived projects are omitted. The project name on each record is unchanged.
 */
export function assignableProjects<T extends StagedProject>(projects: readonly T[]): T[] {
  const current = projects.filter((project) => project.stage === "current").sort(byCreatedAt);
  const upcoming = projects.filter((project) => project.stage === "upcoming").sort(byCreatedAt);
  return [...current, ...upcoming];
}

/**
 * Pack filled choices to the left. Filled values keep their relative order.
 * Empty slots end on the right. `slotCount` defaults to the length of `values`.
 */
export function packProjectSlots(values: readonly string[], slotCount = values.length): string[] {
  const filled: string[] = [];
  for (const value of values) {
    if (value) filled.push(value);
  }
  const out: string[] = [];
  for (let i = 0; i < slotCount; i++) out.push(filled[i] ?? "");
  return out;
}

/** Up to five assigned projects, packed left, in assignable-list order. */
export function assignmentSlots(
  grantedProjectIds: readonly string[],
  assignableProjectIds: readonly string[],
  slotCount = SURVEYOR_PROJECT_SLOTS
): string[] {
  const granted = new Set(grantedProjectIds);
  const chosen: string[] = [];
  for (const id of assignableProjectIds) {
    if (!granted.has(id)) continue;
    chosen.push(id);
    if (chosen.length === slotCount) break;
  }
  return packProjectSlots(chosen, slotCount);
}
