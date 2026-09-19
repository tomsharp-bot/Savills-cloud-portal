import type { AssetKind } from "@prisma/client";
import { cellVal, surveyTypeForKind } from "./asset-status.js";
import type { RawRow } from "./excel.js";
import { prisma } from "./prisma.js";

export const OMITTED_SURVEYED_NOTE = "Omitted but already surveyed";
export const SURVEYED_STATUSES = new Set(["Full Survey", "Ext-Only", "Full Surveys", "External Only"]);

export type AddressPatch = {
  number?: string;
  block?: string;
  street?: string;
  area?: string;
  city?: string;
  postcode?: string;
  archetype?: string;
  yearBuilt?: string;
  patch?: string;
  surveyor?: string;
  surveyType?: string;
};

export type RefreshAsset = {
  uprn: string;
  assetStatus: string;
  siteComments: string;
  external: string;
  omitAsset: boolean;
  stockMissing: boolean;
};

export type RefreshPlan = {
  added: { uprn: string; address: AddressPatch }[];
  removed: string[];
  matched: { uprn: string; address: AddressPatch }[];
  error?: string;
};

export function extractUprn(row: RawRow): string {
  return String(cellVal(row, "UPRN") || cellVal(row, "uprn") || "").trim();
}

export function mapStockAddress(raw: RawRow): AddressPatch {
  let number = cellVal(raw, "Number");
  let block = cellVal(raw, "Block");
  let street = cellVal(raw, "Address Line 1") || cellVal(raw, "Street");
  let city = cellVal(raw, "Address Line 5") || cellVal(raw, "City");
  let postcode = cellVal(raw, "Post Code") || cellVal(raw, "Postcode");
  let area = cellVal(raw, "Area");
  const archetype = cellVal(raw, "Archetype");
  const yearBuilt = cellVal(raw, "Year Built");
  const patchName = cellVal(raw, "Patch");
  const surveyor = cellVal(raw, "Surveyor");
  const surveyType = cellVal(raw, "Survey Type");
  const combined = String(cellVal(raw, "Combined Address") || "").trim();
  if (combined && (!street || !postcode)) {
    const parts = combined
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 1 && (number === "" || number == null)) number = parts[0];
    if (parts.length >= 2 && !street) street = parts.slice(1, -1).join(", ") || parts[1];
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (/^[A-Z]{1,2}\d/i.test(last) && !postcode) postcode = last;
      if (parts.length === 2 && !street) street = parts[1];
    }
  }
  const patch: AddressPatch = {};
  if (number !== "" && number != null) patch.number = String(number);
  if (block !== "" && block != null) patch.block = String(block);
  if (street !== "" && street != null) patch.street = String(street);
  if (city !== "" && city != null) patch.city = String(city);
  if (postcode !== "" && postcode != null) patch.postcode = String(postcode);
  if (area !== "" && area != null) patch.area = String(area);
  if (archetype !== "" && archetype != null) patch.archetype = String(archetype);
  if (yearBuilt !== "" && yearBuilt != null) patch.yearBuilt = String(yearBuilt);
  if (patchName !== "" && patchName != null) patch.patch = String(patchName);
  if (surveyor !== "" && surveyor != null) patch.surveyor = String(surveyor);
  if (surveyType !== "" && surveyType != null) patch.surveyType = String(surveyType);
  return patch;
}

function alreadySurveyed(status: string): boolean {
  return SURVEYED_STATUSES.has(String(status || ""));
}

export function appendSurveyedNote(comments: string): string {
  const c = String(comments || "").trim();
  if (c.includes(OMITTED_SURVEYED_NOTE)) return c;
  return c ? `${c} · ${OMITTED_SURVEYED_NOTE}` : OMITTED_SURVEYED_NOTE;
}

export function planStocklistRefresh(existing: RefreshAsset[], fileRows: RawRow[], alsoOmit: boolean): RefreshPlan {
  const fileByUprn = new Map<string, RawRow>();
  for (const raw of fileRows || []) {
    const uprn = extractUprn(raw);
    if (!uprn) continue;
    if (!fileByUprn.has(uprn)) fileByUprn.set(uprn, raw);
  }
  if (!fileByUprn.size) {
    return { added: [], removed: [], matched: [], error: "No UPRN column / values found in file" };
  }

  const stockUprns = new Set(existing.map((r) => String(r.uprn)));
  const added: RefreshPlan["added"] = [];
  const removed: string[] = [];
  const matched: RefreshPlan["matched"] = [];

  for (const r of existing) {
    const u = String(r.uprn);
    if (fileByUprn.has(u)) {
      matched.push({ uprn: u, address: mapStockAddress(fileByUprn.get(u)!) });
    } else {
      removed.push(u);
    }
  }
  for (const uprn of fileByUprn.keys()) {
    if (stockUprns.has(uprn)) continue;
    added.push({ uprn, address: mapStockAddress(fileByUprn.get(uprn)!) });
  }

  void alsoOmit;
  return { added, removed, matched };
}

export async function applyStocklistRefresh(opts: {
  projectId: string;
  kind: AssetKind;
  rows: RawRow[];
  alsoOmit: boolean;
}): Promise<{ added: string[]; removed: string[]; error?: string }> {
  const existing = await prisma.asset.findMany({
    where: { projectId: opts.projectId, kind: opts.kind },
  });
  const plan = planStocklistRefresh(existing, opts.rows, opts.alsoOmit);
  if (plan.error) return { added: [], removed: [], error: plan.error };

  for (const m of plan.matched) {
    const row = existing.find((r) => String(r.uprn) === m.uprn);
    if (!row) continue;
    await prisma.asset.update({
      where: { id: row.id },
      data: {
        stockMissing: false,
        ...m.address,
        siteComments: row.siteComments,
        external: row.external,
        visit1: row.visit1,
        visit2: row.visit2,
        visit3: row.visit3,
        surveyDate: row.surveyDate,
        surveyedBy: row.surveyedBy,
        assetStatus: String(row.external).toLowerCase() === "yes" ? "Ext-Only" : row.assetStatus,
      },
    });
  }

  for (const a of plan.added) {
    await prisma.asset.create({
      data: {
        projectId: opts.projectId,
        kind: opts.kind,
        uprn: a.uprn,
        assetStatus: "No Visit",
        omitAsset: false,
        stockMissing: false,
        surveyType: surveyTypeForKind(opts.kind),
        ...a.address,
      },
    });
  }

  for (const uprn of plan.removed) {
    const row = existing.find((r) => String(r.uprn) === uprn);
    if (!row) continue;
    const surveyed = alreadySurveyed(row.assetStatus);
    await prisma.asset.update({
      where: { id: row.id },
      data: {
        stockMissing: true,
        siteComments: surveyed ? appendSurveyedNote(row.siteComments) : row.siteComments,
        omitAsset: surveyed ? false : opts.alsoOmit ? true : row.omitAsset,
      },
    });
  }

  return { added: plan.added.map((a) => a.uprn), removed: plan.removed };
}
