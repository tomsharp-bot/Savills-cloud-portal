import type { AssetKind } from "@prisma/client";
import { cellVal, surveyTypeForKind } from "./asset-status.js";
import { formatStockDate } from "./dates.js";
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
  residentName?: string;
  residentNumber?: string;
  residentEmail?: string;
  letterDate1?: string;
  letterDate2?: string;
  x1?: string;
  x2?: string;
  x3?: string;
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

function normHeader(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "");
}

/** Flexible header match: exact (case-insensitive) then normalised aliases. */
export function cellValAliases(row: RawRow, aliases: string[]): unknown {
  for (const alias of aliases) {
    const exact = cellVal(row, alias);
    if (exact !== "" && exact != null) return exact;
  }
  const want = new Set(aliases.map(normHeader));
  for (const k of Object.keys(row || {})) {
    if (!want.has(normHeader(k))) continue;
    const v = row[k];
    if (v !== "" && v != null) return v;
  }
  return "";
}

const ADMIN_STOCK_ALIASES: Record<
  "residentName" | "residentNumber" | "residentEmail" | "letterDate1" | "letterDate2" | "x1" | "x2" | "x3",
  string[]
> = {
  residentName: ["Resident Name", "Tenant Name", "Occupier Name"],
  residentNumber: ["Resident Number", "Resident Tel", "Resident Phone", "Resident Telephone", "Contact Number"],
  residentEmail: ["Resident Email", "Resident E-mail", "Resident Email Address", "Email Address"],
  letterDate1: ["Letter Date 1", "Letter Date1", "Letter 1 Date", "Letter1 Date"],
  letterDate2: ["Letter Date 2", "Letter Date2", "Letter 2 Date", "Letter2 Date"],
  x1: ["X1", "X 1"],
  x2: ["X2", "X 2"],
  x3: ["X3", "X 3"],
};

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

  const residentName = cellValAliases(raw, ADMIN_STOCK_ALIASES.residentName);
  const residentNumber = cellValAliases(raw, ADMIN_STOCK_ALIASES.residentNumber);
  const residentEmail = cellValAliases(raw, ADMIN_STOCK_ALIASES.residentEmail);
  const letterDate1 = cellValAliases(raw, ADMIN_STOCK_ALIASES.letterDate1);
  const letterDate2 = cellValAliases(raw, ADMIN_STOCK_ALIASES.letterDate2);
  const x1 = cellValAliases(raw, ADMIN_STOCK_ALIASES.x1);
  const x2 = cellValAliases(raw, ADMIN_STOCK_ALIASES.x2);
  const x3 = cellValAliases(raw, ADMIN_STOCK_ALIASES.x3);
  if (residentName !== "" && residentName != null) patch.residentName = String(residentName);
  if (residentNumber !== "" && residentNumber != null) patch.residentNumber = String(residentNumber);
  if (residentEmail !== "" && residentEmail != null) patch.residentEmail = String(residentEmail);
  if (letterDate1 !== "" && letterDate1 != null) patch.letterDate1 = formatStockDate(letterDate1);
  if (letterDate2 !== "" && letterDate2 != null) patch.letterDate2 = formatStockDate(letterDate2);
  if (x1 !== "" && x1 != null) patch.x1 = String(x1);
  if (x2 !== "" && x2 != null) patch.x2 = String(x2);
  if (x3 !== "" && x3 != null) patch.x3 = String(x3);
  return patch;
}

export function isSurveyedStatus(status: string): boolean {
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
    const surveyed = isSurveyedStatus(row.assetStatus);
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
