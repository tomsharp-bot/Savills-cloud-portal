import type { Asset, AssetKind } from "@prisma/client";
import { applyEpcSurveyType } from "./epc-survey.js";
import { prisma } from "./prisma.js";
import { attachAgency } from "./stock-page.js";

export type StockGridRow = Asset & { agency: string };

/** One stock tab, with agency filled in and the Condition + EPC survey-type rule applied. */
export async function loadStockRows(
  projectId: string,
  kind: AssetKind,
  conditionEpc: boolean
): Promise<StockGridRow[]> {
  const [assets, surveyors] = await Promise.all([
    prisma.asset.findMany({ where: { projectId, kind } }),
    prisma.user.findMany({
      where: { role: "surveyor" },
      select: { initials: true, agency: true },
    }),
  ]);
  const agencyByInitials = new Map(
    surveyors.filter((s) => s.initials).map((s) => [s.initials!.toUpperCase(), s.agency || ""])
  );
  return attachAgency(assets, agencyByInitials).map((row) => applyEpcSurveyType(row, conditionEpc));
}
