import type { AssetKind, Prisma, User } from "@prisma/client";
import { prisma } from "./prisma.js";
import { inferStockKind, statusFromVisitLogs, surveyTypeForKind } from "./asset-status.js";
import { cellValAliases } from "./stock-refresh.js";
import { formatVisitDateDisplay, visitDateSortKey } from "./dates.js";
import { baseInitials } from "./initials.js";
import type { RawRow } from "./excel.js";

export const VISIT_LOG_COLS = [
  "ID",
  "UPRN",
  "Combined Address",
  "Visit Type",
  "Data Source",
  "Survey Date",
  "Next Survey",
  "Access Type",
  "Created By",
  "Created On",
  "Survey Design",
] as const;

export type LoaderTarget = "auto" | "dwelling" | "block" | "garage";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function initialsFromCreatedBy(
  createdBy: string,
  surveyors: Pick<User, "name" | "initials" | "username">[]
): string {
  const name = createdBy.trim();
  if (!name) return "";
  const lower = name.toLowerCase();
  const byName = surveyors.find((s) => (s.name || "").toLowerCase() === lower);
  if (byName?.initials) return byName.initials;
  const ini = baseInitials(name);
  const byIni = surveyors.find((s) => (s.initials || "").toUpperCase() === ini);
  if (byIni?.initials) return byIni.initials;
  return ini;
}

function visitCell(raw: RawRow, aliases: string[]): string {
  return str(cellValAliases(raw, aliases));
}

export function normalizeVisit(raw: RawRow, loadedFrom: string) {
  const visitDate =
    formatVisitDateDisplay(cellValAliases(raw, ["Visit Date"])) ||
    formatVisitDateDisplay(cellValAliases(raw, ["Survey Date"])) ||
    "";
  const surveyDate = formatVisitDateDisplay(cellValAliases(raw, ["Survey Date"])) || visitDate;
  return {
    sourceId: visitCell(raw, ["ID"]),
    uprn: visitCell(raw, ["UPRN"]),
    combinedAddress: visitCell(raw, ["Combined Address"]),
    visitType: visitCell(raw, ["Visit Type"]),
    dataSource: visitCell(raw, ["Data Source"]),
    surveyDate,
    nextSurvey: formatVisitDateDisplay(cellValAliases(raw, ["Next Survey"])),
    accessType: visitCell(raw, ["Access Type"]),
    createdBy: visitCell(raw, ["Created By"]),
    createdOn: formatVisitDateDisplay(cellValAliases(raw, ["Created On"])),
    surveyDesign: visitCell(raw, ["Survey Design"]),
    visitDate,
    number: visitCell(raw, ["Number"]),
    block: visitCell(raw, ["Block"]),
    addressLine1: visitCell(raw, ["Address Line 1", "Street"]),
    addressLine5: visitCell(raw, ["Address Line 5", "City"]),
    postcode: visitCell(raw, ["Post Code", "Postcode"]),
    archetype: visitCell(raw, ["Archetype"]),
    loadedFrom,
  };
}

function parseCombinedAddress(combined: string): { number: string; street: string; postcode: string } {
  const parts = combined
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let number = "";
  let street = "";
  let postcode = "";
  if (parts.length >= 1) number = parts[0];
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^[A-Z]{1,2}\d/i.test(last)) postcode = last;
    street = parts.slice(1, postcode ? -1 : undefined).join(", ") || (parts.length === 2 ? parts[1] : "");
  }
  return { number, street, postcode };
}

export async function applyVisitRows(opts: {
  projectId: string;
  rows: RawRow[];
  target: LoaderTarget;
  filename: string;
}): Promise<{ appended: number; touched: number; byTab: Record<AssetKind, number>; newSuccessful: number }> {
  const loadedFrom = opts.filename;
  const normalized = opts.rows
    .map((raw) => ({ raw, n: normalizeVisit(raw, loadedFrom) }))
    .filter(({ n }) => n.uprn || n.sourceId);

  if (!normalized.length) {
    return { appended: 0, touched: 0, byTab: { dwelling: 0, block: 0, garage: 0 }, newSuccessful: 0 };
  }

  await prisma.visitLog.createMany({
    data: normalized.map(({ n }) => ({
      projectId: opts.projectId,
      ...n,
    })),
  });

  const surveyors = await prisma.user.findMany({
    where: { role: "surveyor" },
    select: { name: true, initials: true, username: true },
  });

  const uprns = [...new Set(normalized.map(({ n }) => n.uprn).filter(Boolean))];
  const allVisits = await prisma.visitLog.findMany({
    where: { projectId: opts.projectId, uprn: { in: uprns } },
    orderBy: { loadedAt: "asc" },
  });

  const byUprn = new Map<string, typeof allVisits>();
  for (const v of allVisits) {
    const list = byUprn.get(v.uprn) || [];
    list.push(v);
    byUprn.set(v.uprn, list);
  }

  let touched = 0;
  let newSuccessful = 0;
  const byTab: Record<AssetKind, number> = { dwelling: 0, block: 0, garage: 0 };

  for (const uprn of uprns) {
    const visits = (byUprn.get(uprn) || []).slice().sort((a, b) => {
      const ka = visitDateSortKey(a.visitDate || a.surveyDate);
      const kb = visitDateSortKey(b.visitDate || b.surveyDate);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    if (!visits.length) continue;

    let kind: AssetKind;
    if (opts.target === "auto") {
      kind = "dwelling";
      for (const v of visits) {
        const inferred = inferStockKind({
          "Survey Design": v.surveyDesign,
          Archetype: v.archetype,
          "Visit Type": v.visitType,
          "Combined Address": v.combinedAddress,
        });
        if (inferred === "garage") kind = "garage";
        else if (inferred === "block" && kind !== "garage") kind = "block";
      }
    } else {
      kind = opts.target;
    }
    const existingExact = await prisma.asset.findUnique({
      where: { projectId_kind_uprn: { projectId: opts.projectId, kind, uprn } },
    });
    let existing = existingExact;
    if (!existing && opts.target === "auto") {
      existing = await prisma.asset.findFirst({
        where: { projectId: opts.projectId, uprn },
      });
      if (existing) kind = existing.kind;
    }
    byTab[kind] += 1;

    const latest = visits[visits.length - 1];
    let number = latest.number;
    let block = latest.block;
    let street = latest.addressLine1;
    let city = latest.addressLine5;
    let postcode = latest.postcode;
    if (latest.combinedAddress && (!street || !postcode)) {
      const parsed = parseCombinedAddress(latest.combinedAddress);
      if (!number) number = parsed.number;
      if (!street) street = parsed.street;
      if (!postcode) postcode = parsed.postcode;
    }

    const uniqDates: string[] = [];
    for (const v of visits) {
      const d = formatVisitDateDisplay(v.visitDate || v.surveyDate);
      if (d && !uniqDates.includes(d)) uniqDates.push(d);
    }

    const st = statusFromVisitLogs(visits);
    const withType = visits.filter((v) => v.visitType);
    const lastTyped = withType[withType.length - 1];
    const initials = lastTyped ? initialsFromCreatedBy(lastTyped.createdBy, surveyors) : "";

    const siteComments = existing?.siteComments ?? "";
    const external = existing?.external ?? "";
    let assetStatus = st.assetStatus;
    if (String(external).toLowerCase() === "yes") assetStatus = "Ext-Only";

    const data: Prisma.AssetUncheckedCreateInput = {
      projectId: opts.projectId,
      kind,
      uprn,
      assetStatus,
      surveyDate: st.setSurveyFields ? formatVisitDateDisplay(lastTyped?.visitDate || lastTyped?.surveyDate) : "",
      surveyedBy: st.setSurveyFields ? initials : "",
      visit1: uniqDates[0] || "",
      visit2: uniqDates[1] || "",
      visit3: uniqDates[2] || "",
      number,
      block,
      street,
      area: existing?.area || "",
      city,
      postcode,
      archetype: latest.archetype || existing?.archetype || "",
      yearBuilt: existing?.yearBuilt || "",
      patch: existing?.patch || "",
      surveyor: initials || existing?.surveyor || "",
      surveyType: existing?.surveyType || surveyTypeForKind(kind),
      siteComments,
      external,
      omitAsset: existing?.omitAsset ?? false,
      stockMissing: existing?.stockMissing ?? false,
    };

    if (!existing) {
      await prisma.asset.create({ data });
      if (assetStatus === "Full Survey") newSuccessful += 1;
    } else {
      await prisma.asset.update({
        where: { id: existing.id },
        data: {
          assetStatus: data.assetStatus,
          surveyDate: data.surveyDate,
          surveyedBy: data.surveyedBy,
          visit1: data.visit1,
          visit2: data.visit2,
          visit3: data.visit3,
          number: data.number,
          block: data.block,
          street: data.street,
          city: data.city,
          postcode: data.postcode,
          archetype: data.archetype,
          surveyor: data.surveyor,
          siteComments,
          external,
        },
      });
      if (existing.assetStatus !== "Full Survey" && assetStatus === "Full Survey" && !existing.omitAsset) {
        newSuccessful += 1;
      }
    }
    touched += 1;
  }

  return { appended: normalized.length, touched, byTab, newSuccessful };
}
