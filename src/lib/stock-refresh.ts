import type { AssetKind } from "@prisma/client";
import { cellVal, inferStockKind, surveyTypeForKind } from "./asset-status.js";
import { formatStockDate } from "./dates.js";
import type { RawRow } from "./excel.js";
import { prisma } from "./prisma.js";

export const OMITTED_SURVEYED_NOTE = "Omitted but already surveyed";
export const SURVEYED_STATUSES = new Set(["Full Survey", "Ext-Only", "Full Surveys", "External Only"]);

export type StockRefreshTarget = "auto" | AssetKind;

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
  kind: AssetKind;
  id?: string;
  assetStatus: string;
  siteComments: string;
  external: string;
  omitAsset: boolean;
  stockMissing: boolean;
};

export type RefreshPlanItem = {
  uprn: string;
  kind: AssetKind;
  address: AddressPatch;
};

export type ReclassifyItem = {
  uprn: string;
  from: AssetKind;
  to: AssetKind;
  address: AddressPatch;
};

export type RefreshPlan = {
  added: RefreshPlanItem[];
  removed: string[];
  matched: RefreshPlanItem[];
  reclassified: ReclassifyItem[];
  error?: string;
};

export function emptyByTab(): Record<AssetKind, number> {
  return { dwelling: 0, block: 0, garage: 0 };
}

/** Explicit Dwellings/Blocks/Garages target keeps that tab; Auto infers per row. */
export function kindForStockRow(raw: RawRow, target: StockRefreshTarget = "auto"): AssetKind {
  if (target !== "auto") return target;
  return inferStockKind(raw);
}

export function formatStockRefreshResult(opts: {
  addedByTab: Record<AssetKind, number>;
  removedCount: number;
  movedCount?: number;
  alsoOmit?: boolean;
}): string {
  const { addedByTab, removedCount, movedCount = 0, alsoOmit } = opts;
  let msg =
    `Added ${addedByTab.dwelling} dwellings, ${addedByTab.block} blocks, ${addedByTab.garage} garages` +
    ` · Removed (marked) ${removedCount}`;
  if (movedCount) msg += ` · Moved ${movedCount} onto the file’s tab`;
  if (alsoOmit) msg += " · omitted from counts";
  return msg;
}

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

/**
 * Plan add / match / remove / reclassify for a stocklist file.
 *
 * Refresh rule: if a UPRN already sits on one tab but the file classifies it
 * (Archetype / Survey Design / Asset Type / Survey Type / similar → garage, block, or dwelling),
 * the file’s classification wins and the asset is moved to that tab.
 */
export function planStocklistRefresh(
  existing: RefreshAsset[],
  fileRows: RawRow[],
  alsoOmit: boolean,
  target: StockRefreshTarget = "auto"
): RefreshPlan {
  const empty: RefreshPlan = { added: [], removed: [], matched: [], reclassified: [] };
  const fileByUprn = new Map<string, { raw: RawRow; kind: AssetKind }>();
  for (const raw of fileRows || []) {
    const uprn = extractUprn(raw);
    if (!uprn) continue;
    if (!fileByUprn.has(uprn)) fileByUprn.set(uprn, { raw, kind: kindForStockRow(raw, target) });
  }
  if (!fileByUprn.size) {
    return { ...empty, error: "No UPRN column / values found in file" };
  }

  const existingByUprn = new Map<string, RefreshAsset[]>();
  for (const r of existing) {
    const u = String(r.uprn);
    const list = existingByUprn.get(u) || [];
    list.push(r);
    existingByUprn.set(u, list);
  }

  const added: RefreshPlan["added"] = [];
  const removed: string[] = [];
  const matched: RefreshPlan["matched"] = [];
  const reclassified: RefreshPlan["reclassified"] = [];
  const removedSeen = new Set<string>();

  for (const [uprn, rows] of existingByUprn) {
    const file = fileByUprn.get(uprn);
    if (!file) {
      if (!removedSeen.has(uprn)) {
        removed.push(uprn);
        removedSeen.add(uprn);
      }
      continue;
    }
    const address = mapStockAddress(file.raw);
    const sameKind = rows.filter((r) => r.kind === file.kind);
    const otherKind = rows.filter((r) => r.kind !== file.kind);
    if (sameKind.length) {
      matched.push({ uprn, kind: file.kind, address });
      for (const extra of otherKind) {
        reclassified.push({ uprn, from: extra.kind, to: file.kind, address });
      }
    } else if (otherKind.length) {
      for (const extra of otherKind) {
        reclassified.push({ uprn, from: extra.kind, to: file.kind, address });
      }
    }
  }

  for (const [uprn, file] of fileByUprn) {
    if (existingByUprn.has(uprn)) continue;
    added.push({ uprn, kind: file.kind, address: mapStockAddress(file.raw) });
  }

  void alsoOmit;
  return { added, removed, matched, reclassified };
}

export async function applyStocklistRefresh(opts: {
  projectId: string;
  target: StockRefreshTarget;
  rows: RawRow[];
  alsoOmit: boolean;
}): Promise<{
  added: string[];
  removed: string[];
  addedByTab: Record<AssetKind, number>;
  moved: number;
  error?: string;
}> {
  const existing = await prisma.asset.findMany({
    where:
      opts.target === "auto"
        ? { projectId: opts.projectId }
        : { projectId: opts.projectId, kind: opts.target },
  });
  const plan = planStocklistRefresh(existing, opts.rows, opts.alsoOmit, opts.target);
  const addedByTab = emptyByTab();
  if (plan.error) return { added: [], removed: [], addedByTab, moved: 0, error: plan.error };

  for (const m of plan.matched) {
    const row = existing.find((r) => String(r.uprn) === m.uprn && r.kind === m.kind);
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

  for (const r of plan.reclassified) {
    const row = existing.find((e) => String(e.uprn) === r.uprn && e.kind === r.from);
    if (!row) continue;
    const conflict = existing.find((e) => String(e.uprn) === r.uprn && e.kind === r.to && e.id !== row.id);
    if (conflict) {
      const takeVisits = !conflict.visit1 && row.visit1;
      await prisma.asset.update({
        where: { id: conflict.id },
        data: {
          stockMissing: false,
          ...r.address,
          siteComments: conflict.siteComments || row.siteComments,
          external: conflict.external || row.external,
          visit1: takeVisits ? row.visit1 : conflict.visit1,
          visit2: takeVisits ? row.visit2 : conflict.visit2,
          visit3: takeVisits ? row.visit3 : conflict.visit3,
          surveyDate: takeVisits ? row.surveyDate : conflict.surveyDate,
          surveyedBy: takeVisits ? row.surveyedBy : conflict.surveyedBy,
          assetStatus:
            String(conflict.external || row.external).toLowerCase() === "yes"
              ? "Ext-Only"
              : takeVisits
                ? row.assetStatus
                : conflict.assetStatus,
        },
      });
      await prisma.asset.delete({ where: { id: row.id } });
    } else {
      await prisma.asset.update({
        where: { id: row.id },
        data: {
          kind: r.to,
          stockMissing: false,
          ...r.address,
          surveyType: r.address.surveyType || surveyTypeForKind(r.to),
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
      row.kind = r.to;
    }
  }

  for (const a of plan.added) {
    await prisma.asset.create({
      data: {
        projectId: opts.projectId,
        kind: a.kind,
        uprn: a.uprn,
        assetStatus: "No Visit",
        omitAsset: false,
        stockMissing: false,
        surveyType: surveyTypeForKind(a.kind),
        ...a.address,
      },
    });
    addedByTab[a.kind] += 1;
  }

  for (const uprn of plan.removed) {
    const rows = existing.filter((r) => String(r.uprn) === uprn);
    for (const row of rows) {
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
  }

  return {
    added: plan.added.map((a) => a.uprn),
    removed: plan.removed,
    addedByTab,
    moved: plan.reclassified.length,
  };
}
