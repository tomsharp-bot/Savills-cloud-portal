import * as XLSX from "xlsx";
import { cellVal } from "./asset-status.js";

export type RawRow = Record<string, unknown>;

function expandSheetRef(sheet: XLSX.WorkSheet): XLSX.WorkSheet {
  if (!sheet) return sheet;
  let maxR = 0;
  let maxC = 0;
  Object.keys(sheet).forEach((k) => {
    if (k[0] === "!") return;
    const m = XLSX.utils.decode_cell(k);
    if (m.r > maxR) maxR = m.r;
    if (m.c > maxC) maxC = m.c;
  });
  if (maxR > 0 || maxC > 0) {
    const next = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    const cur = sheet["!ref"] || "";
    try {
      const a = XLSX.utils.decode_range(cur || "A1");
      const b = XLSX.utils.decode_range(next);
      const wider = b.e.r > a.e.r || b.e.c > a.e.c;
      if (!cur || wider) sheet["!ref"] = next;
    } catch {
      sheet["!ref"] = next;
    }
  }
  return sheet;
}

function rowsFromSheet(sheet: XLSX.WorkSheet): RawRow[] {
  expandSheetRef(sheet);
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }) as RawRow[];
}

function pickDataSheet(workbook: XLSX.WorkBook): { name: string; sheet: XLSX.WorkSheet } | null {
  if (!workbook?.SheetNames?.length) return null;
  let name = workbook.SheetNames.find((n) => n.trim() === "Asset Visits");
  if (!name) name = workbook.SheetNames.find((n) => n === " Data" || n.trim() === "Data");
  if (!name) {
    name = workbook.SheetNames.find((n) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1, defval: "" }) as unknown[][];
      if (!rows.length) return false;
      const hdr = rows[0].map((h) => String(h || "").trim().toLowerCase());
      return hdr.includes("uprn") && (hdr.includes("access type") || hdr.includes("visit date") || hdr.includes("survey date"));
    });
  }
  if (!name) name = workbook.SheetNames[0];
  return { name, sheet: workbook.Sheets[name] };
}

export function parseCsvText(text: string): RawRow[] {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  if (!lines.length) return [];
  function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    const obj: RawRow = {};
    headers.forEach((h, j) => {
      obj[h] = cells[j] != null ? cells[j] : "";
    });
    rows.push(obj);
  }
  return rows;
}

function sheetHasUprn(sheet: XLSX.WorkSheet | undefined): boolean {
  if (!sheet) return false;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  if (!rows.length) return false;
  const hdr = rows[0].map((h) => String(h || "").trim().toLowerCase());
  return hdr.includes("uprn");
}

function pickUprnSheet(workbook: XLSX.WorkBook): { name: string; sheet: XLSX.WorkSheet } | null {
  if (!workbook?.SheetNames?.length) return null;
  const name = workbook.SheetNames.find((n) => sheetHasUprn(workbook.Sheets[n])) || workbook.SheetNames[0];
  return { name, sheet: workbook.Sheets[name] };
}

/** Every sheet that has a UPRN column, in workbook order. */
function allUprnSheets(workbook: XLSX.WorkBook): { name: string; sheet: XLSX.WorkSheet }[] {
  if (!workbook?.SheetNames?.length) return [];
  const found = workbook.SheetNames.filter((n) => sheetHasUprn(workbook.Sheets[n])).map((name) => ({
    name,
    sheet: workbook.Sheets[name],
  }));
  if (found.length) return found;
  const name = workbook.SheetNames[0];
  return [{ name, sheet: workbook.Sheets[name] }];
}

export function parseWorkbook(buffer: Buffer, filename: string): RawRow[] {
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".csv")) {
    return parseCsvText(buffer.toString("utf8"));
  }
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const picked = pickDataSheet(wb);
  if (!picked) throw new Error("No sheet found");
  return rowsFromSheet(picked.sheet);
}

/**
 * Stocklist / External list.
 * `allSheets` reads every sheet with a UPRN column so a Dwellings sheet is not
 * dropped when Blocks is the first tab in the workbook.
 */
export function parseUprnWorkbook(
  buffer: Buffer,
  filename: string,
  opts: { allSheets?: boolean } = {}
): RawRow[] {
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".csv")) {
    return parseCsvText(buffer.toString("utf8"));
  }
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  if (opts.allSheets) {
    const sheets = allUprnSheets(wb);
    if (!sheets.length) throw new Error("No sheet found");
    return sheets.flatMap((picked) => rowsFromSheet(picked.sheet));
  }
  const picked = pickUprnSheet(wb);
  if (!picked) throw new Error("No sheet found");
  return rowsFromSheet(picked.sheet);
}

export function rowHasUprn(row: RawRow): boolean {
  return Boolean(String(cellVal(row, "UPRN") || "").trim() || cellVal(row, "ID"));
}

/**
 * TODO (Excel polish):
 * - Quarantine-style " Data" sheets with extra unused columns
 * - Merged header rows / two-row headers
 * - Very large workbooks (~938 visits) streaming
 */
