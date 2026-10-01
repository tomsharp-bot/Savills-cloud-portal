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

/**
 * Old 29 hazard categories, in Colin's Category Lists order.
 * Only Onward and Vico offer these. Every other project keeps HHSRS_CATEGORIES.
 */
export const HHSRS_LEGACY_CATEGORIES = [
  "Falls associated with baths etc",
  "Falls on level",
  "Falls between levels",
  "Falls associated with stairs and steps",
  "Electrical Hazards",
  "Fire",
  "Hot surfaces and materials",
  "Collision and entrapment",
  "Explosions",
  "Ergonomics (Position & operability of amenities)",
  "Structural collapse and falling elements",
  "Domestic hygiene, pests and refuse",
  "Food safety",
  "Personal hygiene, sanitation and drainage",
  "Water supply for domestic purpose",
  "Damp / Mould Growth",
  "Excessive cold",
  "Excess heat",
  "Asbestos",
  "Biocides",
  "Carbon monoxide and fuel combustion",
  "Lead",
  "Radiation",
  "Uncombusted fuel gas",
  "Volatile Organic Compounds",
  "Noise",
  "Entry by intruders",
  "Lighting",
  "Overcrowding",
] as const;

export type HhsrsLegacyCategory = (typeof HHSRS_LEGACY_CATEGORIES)[number];

/** Office Reporter fallback. Project schemes in the reporter use their own lists. */
export const HHSRS_RATINGS = ["Low", "Medium", "High"] as const;
export type HhsrsRating = (typeof HHSRS_RATINGS)[number];

/**
 * Ratings already stored from the earlier shared site-form list.
 * Onward and Vico now offer only HHSRS_ONWARD_VICO_RATINGS.
 * Every other project offers HHSRS_SITE_FORM_NEW_RATINGS.
 * This wider list stays so a rating already on a saved case is still recognised.
 */
export const HHSRS_SITE_FORM_RATINGS = [
  "Low",
  "Medium",
  "Slight",
  "Moderate",
  "Severe",
  "High - Emergency Risk",
  "High - Severe Risk",
] as const;

/** Onward and Vico only. */
export const HHSRS_ONWARD_VICO_RATINGS = ["Slight", "Moderate", "Severe"] as const;

/**
 * Surveyor site-form ratings for projects on the new scheme.
 * No plain High, and no "High – severe risk".
 */
export const HHSRS_SITE_FORM_NEW_RATINGS = [
  "Low",
  "Medium",
  "High - Emergency risk",
  "High - Significant risk",
] as const;

export type HhsrsSiteFormRating =
  | (typeof HHSRS_SITE_FORM_RATINGS)[number]
  | (typeof HHSRS_SITE_FORM_NEW_RATINGS)[number];

export function isHhsrsCategory(value: string): value is HhsrsCategory {
  return (HHSRS_CATEGORIES as readonly string[]).includes(value);
}

export function isHhsrsRating(value: string): value is HhsrsRating {
  return (HHSRS_RATINGS as readonly string[]).includes(value);
}

export function isHhsrsSiteFormRating(value: string): value is HhsrsSiteFormRating {
  return (
    (HHSRS_SITE_FORM_RATINGS as readonly string[]).includes(value) ||
    (HHSRS_SITE_FORM_NEW_RATINGS as readonly string[]).includes(value)
  );
}
