import * as XLSX from "xlsx";
import { cellVal } from "./asset-status.js";

export type RawRow = Record<string, unknown>;

/** How many leading rows to scan for a UPRN header (title blocks sit above it). */
export const UPRN_HEADER_SCAN_ROWS = 30;

function normHeader(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./:]+/g, "");
}

/**
 * Exact "UPRN", or a stock-export alias such as "Asset UPRN" / "UPRN Number".
 * "UPRN Status" is not an alias — that column is not the match key.
 */
export function isUprnHeader(header: string): boolean {
  const key = normHeader(header);
  if (key === "uprn") return true;
  const affixes = ["asset", "property", "prop", "number", "no", "num", "ref", "code", "id"];
  return affixes.some((affix) => key === affix + "uprn" || key === "uprn" + affix);
}

function widenRef(sheet: XLSX.WorkSheet, maxR: number, maxC: number): void {
  if (maxR <= 0 && maxC <= 0) return;
  const next = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  const cur = sheet["!ref"] || "";
  try {
    const a = XLSX.utils.decode_range(cur || "A1");
    const b = XLSX.utils.decode_range(next);
    const wider = b.e.r > a.e.r || b.e.c > a.e.c || b.s.r < a.s.r || b.s.c < a.s.c;
    if (!cur || wider) sheet["!ref"] = next;
  } catch {
    sheet["!ref"] = next;
  }
}

/**
 * Some exporters freeze the worksheet dimension (`!ref`) on an old used-range.
 * Excel recalculates it on open, so the file looks complete, but SheetJS only
 * returns rows inside `!ref`. The cells are still on the sheet — stretch the
 * range to cover them.
 */
function expandSheetRef(sheet: XLSX.WorkSheet): XLSX.WorkSheet {
  if (!sheet) return sheet;
  let maxR = 0;
  let maxC = 0;
  for (const k of Object.keys(sheet)) {
    if (k[0] === "!") continue;
    try {
      const m = XLSX.utils.decode_cell(k);
      if (m.r > maxR) maxR = m.r;
      if (m.c > maxC) maxC = m.c;
    } catch {
      // Not a cell address.
    }
  }
  widenRef(sheet, maxR, maxC);
  return sheet;
}

/** 0-based absolute row of the UPRN header, or -1. */
function findUprnHeaderRow(sheet: XLSX.WorkSheet): number {
  if (!sheet?.["!ref"]) return -1;
  let range: XLSX.Range;
  try {
    range = XLSX.utils.decode_range(sheet["!ref"]);
  } catch {
    return -1;
  }
  const lastRow = Math.min(range.e.r, range.s.r + UPRN_HEADER_SCAN_ROWS - 1);
  for (let r = range.s.r; r <= lastRow; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell?.v == null || cell.v === "") continue;
      if (isUprnHeader(String(cell.v))) return r;
    }
  }
  return -1;
}

function aliasUprn(row: RawRow): RawRow {
  for (const key of Object.keys(row)) {
    if (normHeader(key) !== "uprn") continue;
    if (row[key] != null && String(row[key]).trim() !== "") return row;
  }
  for (const key of Object.keys(row)) {
    if (normHeader(key) === "uprn" || !isUprnHeader(key)) continue;
    if (row[key] == null || String(row[key]).trim() === "") continue;
    row.UPRN = row[key];
    break;
  }
  return row;
}

export type StockSheetRead = {
  rows: RawRow[];
  /** 1-based header row in the sheet. 0 when no UPRN header was found. */
  headerRow: number;
};

/** Read one worksheet, repairing a short !ref and a title block above the header. */
export function readStockSheet(sheet: XLSX.WorkSheet): StockSheetRead {
  expandSheetRef(sheet);
  const headerAbs = findUprnHeaderRow(sheet);
  const opts: XLSX.Sheet2JSONOpts = { defval: "", raw: true };
  if (headerAbs > 0) opts.range = headerAbs;
  const rows = (XLSX.utils.sheet_to_json(sheet, opts) as RawRow[]).map(aliasUprn);
  return { rows, headerRow: headerAbs >= 0 ? headerAbs + 1 : 0 };
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
  const lines = csvLines(text);
  if (!lines.length) return [];
  return rowsFromCsvLines(lines, 0);
}

function sheetHasUprn(sheet: XLSX.WorkSheet | undefined): boolean {
  if (!sheet) return false;
  expandSheetRef(sheet);
  return findUprnHeaderRow(sheet) >= 0;
}

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

function csvLines(text: string): string[] {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
}

function rowsFromCsvLines(lines: string[], headerIdx: number): RawRow[] {
  if (!lines.length || headerIdx >= lines.length) return [];
  const headers = splitCsvLine(lines[headerIdx]).map((h) => h.trim());
  const rows: RawRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    const obj: RawRow = {};
    headers.forEach((h, j) => {
      obj[h] = cells[j] != null ? cells[j] : "";
    });
    rows.push(aliasUprn(obj));
  }
  return rows;
}

function findCsvHeaderLine(lines: string[]): number {
  const limit = Math.min(lines.length, UPRN_HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    if (!lines[i].trim()) continue;
    if (splitCsvLine(lines[i]).some((cell) => isUprnHeader(cell))) return i;
  }
  return 0;
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

export type StockSheetInfo = {
  name: string;
  rows: number;
  /** 1-based header row. 0 when the sheet had no UPRN header. */
  headerRow: number;
};

export type ParsedStockWorkbook = {
  rows: RawRow[];
  sheets: StockSheetInfo[];
  warnings: string[];
};

const XLSX_READ_OPTS: XLSX.ParsingOptions = {
  type: "buffer",
  cellDates: true,
  cellStyles: false,
  cellNF: false,
  cellHTML: false,
  bookVBA: false,
};

function capWarnings(warnings: string[]): string[] {
  const max = 6;
  if (warnings.length <= max) return warnings;
  return [...warnings.slice(0, max), `…and ${warnings.length - max} more sheets skipped.`];
}

function readUprnWorkbook(buffer: Buffer, filename: string, allSheets: boolean): ParsedStockWorkbook {
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".csv")) {
    const lines = csvLines(buffer.toString("utf8"));
    const headerIdx = findCsvHeaderLine(lines);
    const rows = rowsFromCsvLines(lines, headerIdx);
    const found = lines.slice(0, UPRN_HEADER_SCAN_ROWS).some((line) => splitCsvLine(line).some((cell) => isUprnHeader(cell)));
    return {
      rows,
      sheets: [{ name: filename || "csv", rows: rows.length, headerRow: found ? headerIdx + 1 : 0 }],
      warnings: found ? [] : ["No UPRN header in the first 30 lines; used the first row as the header."],
    };
  }
  const wb = XLSX.read(buffer, XLSX_READ_OPTS);
  if (!wb?.SheetNames?.length) throw new Error("No sheet found");
  const explicit: string[] = [];
  const warnings: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (sheet && sheetHasUprn(sheet)) explicit.push(sheetName);
    else warnings.push(`Skipped sheet "${sheetName}" (no UPRN header in the first ${UPRN_HEADER_SCAN_ROWS} rows).`);
  }
  let chosen = explicit;
  if (!chosen.length) {
    chosen = [wb.SheetNames[0]];
    warnings.length = 0;
    warnings.push(`No sheet had a UPRN header; used "${wb.SheetNames[0]}".`);
  } else if (!allSheets) {
    const skipped = explicit.slice(1).map((sheetName) => `Skipped sheet "${sheetName}" (only the first UPRN sheet is used here).`);
    warnings.length = 0;
    chosen = [explicit[0]];
    warnings.push(...skipped);
  }
  const sheets: StockSheetInfo[] = [];
  const rows: RawRow[] = [];
  for (const sheetName of chosen) {
    const read = readStockSheet(wb.Sheets[sheetName]);
    sheets.push({ name: sheetName, rows: read.rows.length, headerRow: read.headerRow });
    for (const row of read.rows) rows.push(row);
  }
  return { rows, sheets, warnings: capWarnings(warnings) };
}

/**
 * Stocklist workbook: every sheet with a UPRN header, including a title block
 * above that header and a dimension record that is shorter than the cells.
 */
export function parseStockWorkbook(buffer: Buffer, filename: string): ParsedStockWorkbook {
  return readUprnWorkbook(buffer, filename, true);
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
  return readUprnWorkbook(buffer, filename, !!opts.allSheets).rows;
}

export function rowHasUprn(row: RawRow): boolean {
  return Boolean(String(cellVal(row, "UPRN") || "").trim() || cellVal(row, "ID"));
}

/** TODO: two-row / merged headers on quarantine-style sheets. */
