import { isFullSurveyStatus } from "./asset-status.js";

/** Tom's labels for a completed dwelling on a Condition + EPC project. */
export const SURVEY_TYPE_SCS_ONLY = "SCS only";
export const SURVEY_TYPE_SCS_EPC = "SCS + EPC";

/**
 * Full Survey is the stock grid's completed survey status (visit access
 * "Completed" already maps to it). The literal "Completed" is accepted too.
 */
export function isCompletedFullSurveyStatus(status: unknown): boolean {
  if (isFullSurveyStatus(status)) return true;
  const s = String(status ?? "").trim().toLowerCase();
  return s === "completed" || s === "complete";
}

export function isEpcSurveyType(surveyType: unknown): boolean {
  return String(surveyType ?? "").toLowerCase().includes("epc");
}

/** Map an imported Survey Type onto EPC Req. when the label is explicit. */
export function epcRequiredFromSurveyType(surveyType: unknown): boolean | undefined {
  const s = String(surveyType ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (isEpcSurveyType(s)) return true;
  if (s === "condition only" || s === "scs only" || s === "scs") return false;
  return undefined;
}

export function surveyTypeForEpcRequired(epcRequired: boolean): string {
  return epcRequired ? SURVEY_TYPE_SCS_EPC : SURVEY_TYPE_SCS_ONLY;
}

const EPC_REQ_TRUE = new Set(["yes", "y", "true", "1", "tick", "ticked", "checked", "✓", "✔", "☑", "✅"]);
const EPC_REQ_FALSE = new Set(["no", "n", "false", "0"]);

/**
 * Tri-state EPC Req. cell. True and false are explicit answers.
 * Blank or unrecognised is undefined so an upload does not overwrite a hand-set tick.
 * Excel boolean TRUE/FALSE and numeric 1/0 are included.
 */
export function parseEpcRequired(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "number" || value == null) return undefined;
  const s = String(value).trim().toLowerCase();
  if (!s) return undefined;
  if (EPC_REQ_TRUE.has(s)) return true;
  if (EPC_REQ_FALSE.has(s)) return false;
  return undefined;
}

/** True only for an explicit Yes. Blank, No, and anything unrecognised are false. */
export function epcRequiredFlag(value: unknown): boolean {
  return parseEpcRequired(value) === true;
}

type EpcAsset = {
  kind?: string | null;
  assetStatus?: string | null;
  surveyType?: string | null;
  epcRequired?: boolean | null;
};

/**
 * On a Condition + EPC project, a completed dwelling's Survey Type follows EPC Req.
 * Other rows keep the survey type already stored.
 */
export function applyEpcSurveyType<T extends EpcAsset>(asset: T, conditionEpc: boolean): T {
  if (!conditionEpc) return asset;
  if (asset.kind !== "dwelling") return asset;
  if (!isCompletedFullSurveyStatus(asset.assetStatus)) return asset;
  const surveyType = surveyTypeForEpcRequired(epcRequiredFlag(asset.epcRequired));
  if (asset.surveyType === surveyType) return asset;
  return { ...asset, surveyType };
}
