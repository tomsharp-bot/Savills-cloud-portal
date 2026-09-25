import { Prisma } from "@prisma/client";
import { ASSET_STATUS_SYNONYMS, type AssetStatus } from "./asset-status.js";
import { STOCK_DATE_COLS, STOCK_SELECT_COLS } from "./stock-columns.js";
import { BLANK_FILTER, NONBLANK_FILTER } from "./stock-filter.js";
import { STOCK_SELECT_OPTION_CAP } from "./stock-page.js";

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Quote an allow-listed Asset column. Never pass raw request input here. */
export function assetCol(name: string): Prisma.Sql {
  if (!IDENT.test(name)) throw new Error("Unknown stock column");
  return Prisma.raw(`a."${name}"`);
}

function dateDisplaySql(col: Prisma.Sql): Prisma.Sql {
  // Mirrors formatStockDate for the shapes stored on stock rows: ISO, DD/MM/YYYY, DD/MM/YY.
  return Prisma.sql`CASE
    WHEN btrim(COALESCE(${col}::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
      substring(btrim(${col}::text) from 9 for 2) || '/' || substring(btrim(${col}::text) from 6 for 2) || '/' || substring(btrim(${col}::text) from 3 for 2)
    WHEN btrim(COALESCE(${col}::text, '')) ~ '^[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4}$' THEN
      lpad(split_part(replace(btrim(${col}::text), '-', '/'), '/', 1), 2, '0') || '/' ||
      lpad(split_part(replace(btrim(${col}::text), '-', '/'), '/', 2), 2, '0') || '/' ||
      right(split_part(replace(btrim(${col}::text), '-', '/'), '/', 3), 2)
    WHEN btrim(COALESCE(${col}::text, '')) ~ '^[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2}$' THEN
      lpad(split_part(replace(btrim(${col}::text), '-', '/'), '/', 1), 2, '0') || '/' ||
      lpad(split_part(replace(btrim(${col}::text), '-', '/'), '/', 2), 2, '0') || '/' ||
      lpad(split_part(replace(btrim(${col}::text), '-', '/'), '/', 3), 2, '0')
    ELSE btrim(COALESCE(${col}::text, ''))
  END`;
}

function agencyDisplaySql(): Prisma.Sql {
  const lookup = (column: Prisma.Sql) => Prisma.sql`(
    SELECT NULLIF(btrim(COALESCE(u.agency, '')), '')
    FROM "User" u
    WHERE u.role::text = 'surveyor'
      AND u.initials IS NOT NULL
      AND btrim(COALESCE(${column}::text, '')) <> ''
      AND upper(btrim(u.initials)) = upper(btrim(${column}::text))
    LIMIT 1
  )`;
  return Prisma.sql`COALESCE(${lookup(assetCol("surveyedBy"))}, ${lookup(assetCol("surveyor"))}, '')`;
}

function statusKeys(status: AssetStatus): string[] {
  return Object.entries(ASSET_STATUS_SYNONYMS)
    .filter(([, label]) => label === status)
    .map(([key]) => key);
}

/** Same folds as assetStatusKey: case, periods, apostrophes, hyphens, and extra spaces. */
function normalizedAssetStatusKey(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`lower(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(btrim(COALESCE(${column}::text, '')), '\\.', '', 'g'), '''', '', 'g'), '[-_]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')))`;
}

function keyIn(keyExpr: Prisma.Sql, keys: string[]): Prisma.Sql {
  return Prisma.sql`${keyExpr} IN (${Prisma.join(keys.map((key) => Prisma.sql`${key}`))})`;
}

function extOnlyStatusSql(keyExpr: Prisma.Sql): Prisma.Sql {
  return keyIn(keyExpr, statusKeys("Ext-Only"));
}

function fullSurveyStatusSql(keyExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${keyIn(keyExpr, statusKeys("Full Survey"))}
    OR ${keyExpr} LIKE 'successful%'
  )`;
}

function surveyTypeDisplaySql(_conditionEpc: boolean): Prisma.Sql {
  const stored = Prisma.sql`btrim(COALESCE(a."surveyType", ''))`;
  const keyExpr = normalizedAssetStatusKey(Prisma.sql`a."assetStatus"`);
  // Same rule as deriveDwellingSurveyType, on every project. Blocks and garages stay stored.
  return Prisma.sql`CASE
    WHEN a.kind::text <> 'dwelling' THEN ${stored}
    WHEN ${extOnlyStatusSql(keyExpr)} THEN 'External'
    WHEN ${fullSurveyStatusSql(keyExpr)} THEN CASE WHEN a."epcRequired" THEN 'SCS + EPC' ELSE 'SCS Only' END
    ELSE ''
  END`;
}

/** Text the grid shows, and therefore the text filters and sorts compare. */
export function stockDisplaySql(column: string, conditionEpc: boolean): Prisma.Sql {
  if (column === "omitAsset") return Prisma.sql`CASE WHEN a."omitAsset" THEN 'omitted' ELSE 'included' END`;
  if (column === "epcRequired") return Prisma.sql`CASE WHEN a."epcRequired" THEN 'YES' ELSE '' END`;
  if (column === "agency") return agencyDisplaySql();
  if (column === "surveyType") return surveyTypeDisplaySql(conditionEpc);
  if (STOCK_DATE_COLS.has(column)) return dateDisplaySql(assetCol(column));
  return Prisma.sql`btrim(COALESCE(${assetCol(column)}::text, ''))`;
}

/** localeCompare(..., { numeric: true }) without pulling the column into Node. */
export function naturalSortKey(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    SELECT COALESCE(string_agg(
      CASE
        WHEN t.part ~ '^[0-9]+$' THEN lpad(t.part, 12, '0')
        ELSE lower(t.part)
      END,
      '' ORDER BY t.ord
    ), '')
    FROM (
      SELECT r.m[1] AS part, r.ord
      FROM regexp_matches(COALESCE(${expr}, ''), '([0-9]+|[^0-9]+)', 'g') WITH ORDINALITY AS r(m, ord)
    ) t
  )`;
}

export function stockScopeSql(projectId: string, kind: string): Prisma.Sql {
  return Prisma.sql`a."projectId" = ${projectId} AND a.kind::text = ${kind}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function filterPredicate(column: string, q: string, exact: boolean, conditionEpc: boolean): Prisma.Sql {
  if (column === "omitAsset") {
    if (q === "omitted") return Prisma.sql`a."omitAsset" = TRUE`;
    if (q === "included") return Prisma.sql`a."omitAsset" = FALSE`;
    return Prisma.sql`FALSE`;
  }
  if (column === "epcRequired") {
    if (q === "yes" || q === NONBLANK_FILTER) return Prisma.sql`a."epcRequired" = TRUE`;
    if (q === BLANK_FILTER) return Prisma.sql`a."epcRequired" = FALSE`;
    return Prisma.sql`FALSE`;
  }
  const expr = stockDisplaySql(column, conditionEpc);
  if (q === BLANK_FILTER) return Prisma.sql`btrim(COALESCE(${expr}, '')) = ''`;
  if (q === NONBLANK_FILTER) return Prisma.sql`btrim(COALESCE(${expr}, '')) <> ''`;
  if (exact) return Prisma.sql`lower(btrim(COALESCE(${expr}, ''))) = ${q}`;
  const pattern = `%${escapeLike(q)}%`;
  return Prisma.sql`lower(btrim(COALESCE(${expr}, ''))) LIKE ${pattern} ESCAPE ${"\\"}`;
}

export function stockFilterSql(
  filters: Record<string, string>,
  exact: Set<string>,
  conditionEpc: boolean,
  allowed: ReadonlySet<string>
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (const [key, raw] of Object.entries(filters)) {
    if (!allowed.has(key)) continue;
    const q = String(raw ?? "").trim().toLowerCase();
    if (!q) continue;
    const isExact = exact.has(key) || key === "omitAsset";
    parts.push(filterPredicate(key, q, isExact, conditionEpc));
  }
  if (!parts.length) return Prisma.sql`TRUE`;
  return Prisma.join(parts, " AND ");
}

export function stockCountQuery(projectId: string, kind: string, where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "Asset" a
    WHERE ${stockScopeSql(projectId, kind)}
      AND (${where})
  `;
}

export function stockIdQuery(args: {
  projectId: string;
  kind: string;
  conditionEpc: boolean;
  where: Prisma.Sql;
  sort: string;
  dir: "asc" | "desc";
  limit: number;
  offset: number;
}): Prisma.Sql {
  const display = stockDisplaySql(args.sort, args.conditionEpc);
  const direction = args.dir === "desc" ? Prisma.raw("DESC") : Prisma.raw("ASC");
  const uprnKey = naturalSortKey(stockDisplaySql("uprn", args.conditionEpc));
  return Prisma.sql`
    SELECT a.id
    FROM "Asset" a
    WHERE ${stockScopeSql(args.projectId, args.kind)}
      AND (${args.where})
    ORDER BY ${naturalSortKey(display)} ${direction}, ${uprnKey} ASC, a.id ASC
    LIMIT ${args.limit}
    OFFSET ${args.offset}
  `;
}

/** One grouped probe per dropdown column, capped so a 40k distinct list never comes back to Node. */
export function stockOptionsQuery(
  projectId: string,
  kind: string,
  columns: readonly string[],
  conditionEpc: boolean
): Prisma.Sql | null {
  const cols = columns.filter(
    (col) => STOCK_SELECT_COLS.has(col) && col !== "epcRequired" && col !== "omitAsset" && IDENT.test(col)
  );
  if (!cols.length) return null;
  const cap = STOCK_SELECT_OPTION_CAP + 1;
  const parts = cols.map(
    (col) => Prisma.sql`
      SELECT ${col}::text AS column_name, d.value
      FROM (
        SELECT ${stockDisplaySql(col, conditionEpc)} AS value
        FROM "Asset" a
        WHERE ${stockScopeSql(projectId, kind)}
        GROUP BY 1
        LIMIT ${cap}
      ) d
    `
  );
  return Prisma.join(parts, " UNION ALL ");
}

/** Flatten nested Prisma.sql fragments so tests can see LIMIT and bound values. */
export function flattenSql(query: Prisma.Sql): { text: string; values: unknown[] } {
  const strings = (query as unknown as { strings?: string[] }).strings;
  const values = (query as unknown as { values?: unknown[] }).values;
  if (!strings) return { text: String(query), values: [] };
  let text = "";
  const flat: unknown[] = [];
  const embed = (value: unknown) => {
    if (value && typeof value === "object" && Array.isArray((value as { strings?: unknown }).strings)) {
      const nested = flattenSql(value as Prisma.Sql);
      text += nested.text;
      flat.push(...nested.values);
      return;
    }
    flat.push(value);
    text += `$${flat.length}`;
  };
  strings.forEach((part, index) => {
    text += part;
    if (index < (values?.length ?? 0)) embed(values?.[index]);
  });
  return { text, values: flat };
}
