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

export function epcRequiredFlag(value: unknown): boolean {
  if (value === true) return true;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "y" || s === "1";
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
