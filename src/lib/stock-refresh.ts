import type { AssetKind, Prisma } from "@prisma/client";
import { cellVal, isCompletedAssetStatus, surveyTypeForKind } from "./asset-status.js";
import { dwellingMisrouteWarning, routeStockRow, type StockRouteTarget } from "./stock-route.js";
import { epcRequiredFromSurveyType, parseEpcRequired } from "./epc-survey.js";
import { formatStockDate } from "./dates.js";
import { uprnText, type RawRow } from "./excel.js";
import { prisma } from "./prisma.js";
import { STOCK_LABELS } from "./stock-columns.js";

export const OMITTED_SURVEYED_NOTE = "Omitted but already surveyed";

export type StockRefreshTarget = StockRouteTarget;

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
  epcRequired?: boolean;
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
  fileRows: number;
  blankUprn: number;
  duplicateUprn: number;
  uniqueUprn: number;
  fileByTab: Record<AssetKind, number>;
};

export function emptyByTab(): Record<AssetKind, number> {
  return { dwelling: 0, block: 0, garage: 0 };
}

/**
 * Rows per INSERT. Each asset row carries well under 40 columns, and Postgres
 * rejects a statement with more than 65535 bind parameters. One `create` per
 * row cannot finish ~44k assets before the request is cut off (~9.5k was what
 * landed). Keep this batch under the parameter ceiling.
 */
export const STOCK_IMPORT_BATCH = 1000;
export const STOCK_IMPORT_COLUMNS = 40;
export const POSTGRES_MAX_BIND_PARAMS = 65535;
/** Address updates are separate statements inside one transaction. */
export const STOCK_UPDATE_BATCH = 250;
/** UPRNs shown on the Data Loader page. The full list is not stored in the session cookie. */
export const STOCK_FLASH_SAMPLE = 25;
/** Wide ~44k-row workbooks can exceed the old 20MB cap and were rejected whole. */
export const STOCK_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;

export type StockFileStats = {
  fileRows: number;
  blankUprn: number;
  duplicateUprn: number;
  uniqueUprn: number;
  fileByTab: Record<AssetKind, number>;
};

export type StockRefreshFlash = {
  projectId: string;
  addedCount: number;
  removedCount: number;
  addedSample: string[];
  removedSample: string[];
  addedByTab: Record<AssetKind, number>;
  alsoOmit: boolean;
  tab: string;
  fileRows: number;
  uniqueUprn: number;
  blankUprn: number;
  duplicateUprn: number;
  fileByTab: Record<AssetKind, number>;
  /** Non-omitted assets stored for the project after this refresh. Matches Summary → Total assets. */
  storedAssets?: number;
};

export function buildStockRefreshFlash(opts: {
  projectId: string;
  added: string[];
  removed: string[];
  addedByTab: Record<AssetKind, number>;
  alsoOmit: boolean;
  tab: string;
  stats: StockFileStats;
  storedAssets?: number;
}): StockRefreshFlash {
  return {
    projectId: opts.projectId,
    addedCount: opts.added.length,
    removedCount: opts.removed.length,
    addedSample: opts.added.slice(0, STOCK_FLASH_SAMPLE),
    removedSample: opts.removed.slice(0, STOCK_FLASH_SAMPLE),
    addedByTab: opts.addedByTab,
    alsoOmit: opts.alsoOmit,
    tab: opts.tab,
    fileRows: opts.stats.fileRows,
    uniqueUprn: opts.stats.uniqueUprn,
    blankUprn: opts.stats.blankUprn,
    duplicateUprn: opts.stats.duplicateUprn,
    fileByTab: opts.stats.fileByTab,
    storedAssets: opts.storedAssets,
  };
}

export function stockCreateInput(projectId: string, item: RefreshPlanItem): Prisma.AssetCreateManyInput {
  return {
    projectId,
    kind: item.kind,
    uprn: item.uprn,
    assetStatus: "No Visit",
    omitAsset: false,
    stockMissing: false,
    surveyType: surveyTypeForKind(item.kind),
    ...item.address,
  };
}

/** Explicit Dwellings/Blocks/Garages target keeps that tab; Auto infers per row. */
export function kindForStockRow(raw: RawRow, target: StockRefreshTarget = "auto"): AssetKind {
  return routeStockRow(raw, target);
}

export function formatStockRefreshResult(opts: {
  addedByTab: Record<AssetKind, number>;
  removedCount: number;
  movedCount?: number;
  alsoOmit?: boolean;
  rows?: RawRow[];
  addedUprns?: string[];
  target?: StockRefreshTarget;
  fileRows?: number;
  uniqueUprn?: number;
  blankUprn?: number;
  duplicateUprn?: number;
  fileByTab?: Record<AssetKind, number>;
  sheets?: { name: string; rows: number; headerRow: number }[];
  warnings?: string[];
  storedAssets?: number;
}): string {
  const { addedByTab, removedCount, movedCount = 0, alsoOmit } = opts;
  let msg =
    `Added ${addedByTab.dwelling} dwellings, ${addedByTab.block} blocks, ${addedByTab.garage} garages` +
    ` · Removed (marked) ${removedCount}`;
  if (opts.fileByTab) {
    const file = opts.fileByTab;
    msg += ` · File has ${file.dwelling} dwellings, ${file.block} blocks, ${file.garage} garages`;
  }
  if (opts.fileRows != null && opts.uniqueUprn != null) {
    msg += ` · ${opts.uniqueUprn} unique UPRN(s) from ${opts.fileRows} file row(s)`;
    if (opts.blankUprn) msg += ` · ${opts.blankUprn} blank UPRN row(s) skipped`;
    if (opts.duplicateUprn) {
      msg += ` · ${opts.duplicateUprn} duplicate UPRN row(s) skipped (first row kept)`;
    }
    if (opts.uniqueUprn < opts.fileRows) {
      msg += ". Summary counts one asset per UPRN, so repeated rows are not extra assets";
    }
  }
  if (opts.storedAssets != null) {
    msg += ` · ${opts.storedAssets} non-omitted asset(s) now stored (Summary → Total assets)`;
  }
  if (opts.sheets?.length) {
    msg += ` · Read ${opts.sheets
      .map((sheet) => `${sheet.name} (${sheet.rows} rows, header row ${sheet.headerRow})`)
      .join("; ")}`;
  }
  if (opts.warnings?.length) msg += ` · ${opts.warnings.join(" ")}`;
  if (movedCount) msg += ` · Moved ${movedCount} onto the file’s tab`;
  if (alsoOmit) msg += " · omitted from counts";
  const warning =
    opts.rows && opts.addedUprns
      ? dwellingMisrouteWarning({
          rows: opts.rows,
          addedByTab,
          addedUprns: opts.addedUprns,
          target: opts.target,
        })
      : null;
  if (warning) msg += `. ${warning}`;
  return msg;
}

export function extractUprn(row: RawRow): string {
  return uprnText(cellValAliases(row, ["UPRN"]));
}

function normHeader(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "");
}

/** Flexible header match: earlier aliases win, including underscore / spacing variants. */
export function cellValAliases(row: RawRow, aliases: string[]): unknown {
  for (const alias of aliases) {
    const exact = cellVal(row, alias);
    if (exact !== "" && exact != null) return exact;
    const want = normHeader(alias);
    for (const k of Object.keys(row || {})) {
      if (normHeader(k) !== want) continue;
      const v = row[k];
      if (v !== "" && v != null) return v;
    }
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

function trimmedCell(raw: RawRow, aliases: string[]): string {
  const v = cellValAliases(raw, aliases);
  if (v == null) return "";
  return String(v).trim();
}

/**
 * EPC Req. column names. The dwellings grid export header is "EPC Req."
 * normHeader strips ".", so "EPC Req." and "EPC Req" both match "epcreq".
 * "EPC" is last so a more specific header wins when several are filled in.
 */
const EPC_REQ_ALIASES = [STOCK_LABELS.epcRequired, "EPC Req", "EPC Required", "EPC Reqd", "EPC"];

export function mapStockAddress(raw: RawRow): AddressPatch {
  let number = trimmedCell(raw, ["Number"]);
  let block = trimmedCell(raw, ["Block"]);
  let street = trimmedCell(raw, ["Address Line 1", "Street"]);
  let city = trimmedCell(raw, ["Address Line 5", "City"]);
  let postcode = trimmedCell(raw, ["Post Code", "Postcode"]);
  let area = trimmedCell(raw, ["Area"]);
  const archetype =
    trimmedCell(raw, ["Archetype"]) ||
    trimmedCell(raw, ["Dwelling Type", "Property Type", "Asset Type", "Building Type", "Unit Type"]);
  const yearBuilt = trimmedCell(raw, ["Year Built"]);
  const patchName = trimmedCell(raw, ["Patch"]);
  const surveyor = trimmedCell(raw, ["Surveyor"]);
  const surveyType = trimmedCell(raw, ["Survey Type"]);
  const combined = trimmedCell(raw, ["Combined Address"]);
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
  if (number) patch.number = number;
  if (block) patch.block = block;
  if (street) patch.street = street;
  if (city) patch.city = city;
  if (postcode) patch.postcode = postcode;
  if (area) patch.area = area;
  if (archetype) patch.archetype = archetype;
  if (yearBuilt) patch.yearBuilt = yearBuilt;
  if (patchName) patch.patch = patchName;
  if (surveyor) patch.surveyor = surveyor;
  if (surveyType) {
    patch.surveyType = surveyType;
    const fromSurveyType = epcRequiredFromSurveyType(surveyType);
    if (fromSurveyType !== undefined) patch.epcRequired = fromSurveyType;
  }
  // Explicit EPC Req. wins over Survey Type. Blank or unrecognised stays off the patch.
  const epcRequired = parseEpcRequired(cellValAliases(raw, EPC_REQ_ALIASES));
  if (epcRequired !== undefined) patch.epcRequired = epcRequired;

  const residentName = cellValAliases(raw, ADMIN_STOCK_ALIASES.residentName);
  const residentNumber = cellValAliases(raw, ADMIN_STOCK_ALIASES.residentNumber);
  const residentEmail = cellValAliases(raw, ADMIN_STOCK_ALIASES.residentEmail);
  const letterDate1 = cellValAliases(raw, ADMIN_STOCK_ALIASES.letterDate1);
  const letterDate2 = cellValAliases(raw, ADMIN_STOCK_ALIASES.letterDate2);
  const x1 = cellValAliases(raw, ADMIN_STOCK_ALIASES.x1);
  const x2 = cellValAliases(raw, ADMIN_STOCK_ALIASES.x2);
  const x3 = cellValAliases(raw, ADMIN_STOCK_ALIASES.x3);
  const residentNameText = String(residentName ?? "").trim();
  const residentNumberText = String(residentNumber ?? "").trim();
  const residentEmailText = String(residentEmail ?? "").trim();
  const letter1 = letterDate1 !== "" && letterDate1 != null ? formatStockDate(letterDate1).trim() : "";
  const letter2 = letterDate2 !== "" && letterDate2 != null ? formatStockDate(letterDate2).trim() : "";
  const x1Text = String(x1 ?? "").trim();
  const x2Text = String(x2 ?? "").trim();
  const x3Text = String(x3 ?? "").trim();
  if (residentNameText) patch.residentName = residentNameText;
  if (residentNumberText) patch.residentNumber = residentNumberText;
  if (residentEmailText) patch.residentEmail = residentEmailText;
  if (letter1) patch.letterDate1 = letter1;
  if (letter2) patch.letterDate2 = letter2;
  if (x1Text) patch.x1 = x1Text;
  if (x2Text) patch.x2 = x2Text;
  if (x3Text) patch.x3 = x3Text;
  return patch;
}

export function isSurveyedStatus(status: string): boolean {
  return isCompletedAssetStatus(status);
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
  const fileByUprn = new Map<string, { raw: RawRow; kind: AssetKind }>();
  const fileByTab = emptyByTab();
  let fileRowCount = 0;
  let blankUprn = 0;
  let duplicateUprn = 0;
  for (const raw of fileRows || []) {
    fileRowCount += 1;
    const uprn = extractUprn(raw);
    if (!uprn) {
      blankUprn += 1;
      continue;
    }
    if (fileByUprn.has(uprn)) {
      duplicateUprn += 1;
      continue;
    }
    const kind = kindForStockRow(raw, target);
    fileByUprn.set(uprn, { raw, kind });
    fileByTab[kind] += 1;
  }
  const stats = {
    fileRows: fileRowCount,
    blankUprn,
    duplicateUprn,
    uniqueUprn: fileByUprn.size,
    fileByTab,
  };
  const empty: RefreshPlan = { added: [], removed: [], matched: [], reclassified: [], ...stats };
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
  return { added, removed, matched, reclassified, ...stats };
}

export type StockRefreshApplyResult = StockFileStats & {
  added: string[];
  removed: string[];
  addedByTab: Record<AssetKind, number>;
  moved: number;
  storedAssets?: number;
  error?: string;
};

const IMPORT_EXISTING_SELECT = {
  id: true,
  kind: true,
  uprn: true,
  assetStatus: true,
  siteComments: true,
  external: true,
  omitAsset: true,
  stockMissing: true,
  visit1: true,
  visit2: true,
  visit3: true,
  surveyDate: true,
  surveyedBy: true,
} as const;

function planStats(plan: RefreshPlan): StockFileStats {
  return {
    fileRows: plan.fileRows,
    blankUprn: plan.blankUprn,
    duplicateUprn: plan.duplicateUprn,
    uniqueUprn: plan.uniqueUprn,
    fileByTab: plan.fileByTab,
  };
}

function causeText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").slice(0, 240);
}

async function updateInChunks(rows: { id: string; data: Prisma.AssetUpdateInput }[]): Promise<void> {
  for (let i = 0; i < rows.length; i += STOCK_UPDATE_BATCH) {
    const chunk = rows.slice(i, i + STOCK_UPDATE_BATCH);
    await prisma.$transaction(chunk.map((row) => prisma.asset.update({ where: { id: row.id }, data: row.data })));
  }
}

export async function applyStocklistRefresh(opts: {
  projectId: string;
  target: StockRefreshTarget;
  rows: RawRow[];
  alsoOmit: boolean;
}): Promise<StockRefreshApplyResult> {
  const existing = await prisma.asset.findMany({
    where:
      opts.target === "auto"
        ? { projectId: opts.projectId }
        : { projectId: opts.projectId, kind: opts.target },
    select: IMPORT_EXISTING_SELECT,
  });
  const plan = planStocklistRefresh(existing, opts.rows, opts.alsoOmit, opts.target);
  const addedByTab = emptyByTab();
  const stats = planStats(plan);
  if (plan.error) return { added: [], removed: [], addedByTab, moved: 0, error: plan.error, ...stats };

  const byKindUprn = new Map<string, (typeof existing)[number]>();
  const byUprn = new Map<string, (typeof existing)[number][]>();
  for (const row of existing) {
    const uprn = String(row.uprn);
    byKindUprn.set(`${row.kind}\0${uprn}`, row);
    const list = byUprn.get(uprn) || [];
    list.push(row);
    byUprn.set(uprn, list);
  }

  // Insert the missing UPRNs first. A retry after a cut-off request then adds
  // the rest before it spends time refreshing rows that are already saved.
  let inserted = 0;
  try {
    for (let i = 0; i < plan.added.length; i += STOCK_IMPORT_BATCH) {
      const chunk = plan.added.slice(i, i + STOCK_IMPORT_BATCH);
      await prisma.asset.createMany({
        data: chunk.map((item) => stockCreateInput(opts.projectId, item)),
      });
      for (const item of chunk) addedByTab[item.kind] += 1;
      inserted += chunk.length;
    }
  } catch (err) {
    throw new Error(
      `Stock import stopped after adding ${inserted} of ${plan.added.length} new assets. Re-apply the same file to continue. ${causeText(err)}`
    );
  }

  try {
    const matchedWrites: { id: string; data: Prisma.AssetUpdateInput }[] = [];
    for (const m of plan.matched) {
      const row = byKindUprn.get(`${m.kind}\0${m.uprn}`);
      if (!row) continue;
      matchedWrites.push({
        id: row.id,
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
    await updateInChunks(matchedWrites);

    for (const r of plan.reclassified) {
      const row = byKindUprn.get(`${r.from}\0${r.uprn}`);
      if (!row) continue;
      const conflict = byKindUprn.get(`${r.to}\0${r.uprn}`);
      if (conflict && conflict.id !== row.id) {
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
        byKindUprn.delete(`${r.from}\0${r.uprn}`);
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
        byKindUprn.delete(`${r.from}\0${r.uprn}`);
        row.kind = r.to;
        byKindUprn.set(`${r.to}\0${r.uprn}`, row);
      }
    }

    const removedWrites: { id: string; data: Prisma.AssetUpdateInput }[] = [];
    for (const uprn of plan.removed) {
      for (const row of byUprn.get(uprn) || []) {
        const surveyed = isSurveyedStatus(row.assetStatus);
        removedWrites.push({
          id: row.id,
          data: {
            stockMissing: true,
            siteComments: surveyed ? appendSurveyedNote(row.siteComments) : row.siteComments,
            omitAsset: surveyed ? false : opts.alsoOmit ? true : row.omitAsset,
          },
        });
      }
    }
    await updateInChunks(removedWrites);
  } catch (err) {
    throw new Error(
      `Saved ${inserted} new asset(s), then a follow-up update stopped. Summary already includes the rows that were saved. Re-apply the same file to finish. ${causeText(err)}`
    );
  }

  let storedAssets: number | undefined;
  try {
    storedAssets = await prisma.asset.count({
      where: { projectId: opts.projectId, omitAsset: false },
    });
  } catch {
    storedAssets = undefined;
  }

  return {
    added: plan.added.map((a) => a.uprn),
    removed: plan.removed,
    addedByTab,
    moved: plan.reclassified.length,
    storedAssets,
    ...stats,
  };
}
