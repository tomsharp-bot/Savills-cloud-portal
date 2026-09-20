/** Unique HHSRS hazard categories (spreadsheet column B). Rating is stored separately. */
export const HHSRS_CATEGORIES = [
  "Fire & Explosions",
  "Carbon Monoxide & Indoor Air Pollutants",
  "Damp & Mould Growth",
  "Electrical Hazards",
  "Structural Collapse & Falling Elements",
  "Falling On Stairs Etc.",
  "Falling Between Levels",
  "Falls On The Level Inc Baths",
  "Domestic Hygiene",
  "Flames & Hot Surfaces Etc",
  "Collisions Entrapment & Ergonomics",
  "Entry By Intruders",
  "Crowding & Space",
  "Asbestos & MMF",
  "Excess Cold",
  "Excess Heat",
  "Lead",
  "Lighting",
  "Noise",
  "Water Supply",
  "Radiation",
] as const;

export type HhsrsCategory = (typeof HHSRS_CATEGORIES)[number];

export const HHSRS_RATINGS = ["Low", "Medium", "High"] as const;
export type HhsrsRating = (typeof HHSRS_RATINGS)[number];

export function isHhsrsCategory(value: string): value is HhsrsCategory {
  return (HHSRS_CATEGORIES as readonly string[]).includes(value);
}

export function isHhsrsRating(value: string): value is HhsrsRating {
  return (HHSRS_RATINGS as readonly string[]).includes(value);
}
