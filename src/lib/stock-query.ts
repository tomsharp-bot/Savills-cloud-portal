import type { Asset, AssetKind, PrismaClient } from "@prisma/client";
import { applyEpcSurveyType } from "./epc-survey.js";
import { prisma } from "./prisma.js";
import { attachAgency } from "./stock-page.js";
import {
  stockCountQuery,
  stockFilterSql,
  stockIdQuery,
  stockOptionsQuery,
} from "./stock-sql.js";
import {
  assembleStockWindow,
  optionsFromProbes,
  type StockGateway,
  type StockWindowRequest,
} from "./stock-window.js";

export type StockGridRow = Asset & { agency: string };

type QueryClient = Pick<PrismaClient, "$queryRaw" | "asset" | "user">;

const OPTION_TTL_MS = 60_000;
const optionCache = new Map<string, { at: number; options: Record<string, string[]> }>();

export function clearStockOptionCache(): void {
  optionCache.clear();
}

function asCount(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Database window over one stock tab.
 * Counts, filters and sorts run in Postgres. Node only hydrates the ids in the
 * requested window, so opening Dwellings on ~44k stock does not load every asset.
 */
export function prismaStockGateway(
  projectId: string,
  kind: AssetKind,
  conditionEpc: boolean,
  columns: readonly string[],
  client: QueryClient = prisma
): StockGateway<StockGridRow> {
  const allowed = new Set(columns);
  const cacheKey = `${projectId}:${kind}:${conditionEpc ? 1 : 0}:${columns.join(",")}`;

  async function agencyMap(): Promise<Map<string, string>> {
    const surveyors = await client.user.findMany({
      where: { role: "surveyor" },
      select: { initials: true, agency: true },
    });
    return new Map(
      surveyors.filter((s) => s.initials).map((s) => [s.initials!.toUpperCase(), s.agency || ""])
    );
  }

  async function count(where: ReturnType<typeof stockFilterSql>): Promise<number> {
    const rows = await client.$queryRaw<Array<{ count: number | bigint }>>(
      stockCountQuery(projectId, kind, where)
    );
    return asCount(rows[0]?.count);
  }

  return {
    total() {
      return count(stockFilterSql({}, new Set(), conditionEpc, allowed));
    },
    matched(req) {
      return count(stockFilterSql(req.filters, req.exact, conditionEpc, allowed));
    },
    async page(req: StockWindowRequest) {
      const where = stockFilterSql(req.filters, req.exact, conditionEpc, allowed);
      const idRows = await client.$queryRaw<Array<{ id: string }>>(
        stockIdQuery({
          projectId,
          kind,
          conditionEpc,
          where,
          sort: allowed.has(req.sort) ? req.sort : "uprn",
          dir: req.dir,
          limit: req.limit,
          offset: req.offset,
        })
      );
      const ids = idRows.map((row) => row.id);
      if (!ids.length) return [];
      const [assets, agencies] = await Promise.all([
        client.asset.findMany({ where: { id: { in: ids } } }),
        agencyMap(),
      ]);
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      const ordered = ids.map((id) => byId.get(id)).filter((asset): asset is Asset => !!asset);
      return attachAgency(ordered, agencies).map((row) => applyEpcSurveyType(row, conditionEpc));
    },
    async options() {
      const cached = optionCache.get(cacheKey);
      if (cached && Date.now() - cached.at < OPTION_TTL_MS) return cached.options;
      const query = stockOptionsQuery(projectId, kind, columns, conditionEpc);
      const probes = query
        ? await client.$queryRaw<Array<{ column_name: string; value: string | null }>>(query)
        : [];
      const options = optionsFromProbes(columns, probes);
      optionCache.set(cacheKey, { at: Date.now(), options });
      return options;
    },
  };
}

export async function loadStockWindow(args: {
  projectId: string;
  kind: AssetKind;
  conditionEpc: boolean;
  columns: readonly string[];
  query: Record<string, unknown>;
  gateway?: StockGateway<StockGridRow>;
}) {
  const gateway =
    args.gateway ?? prismaStockGateway(args.projectId, args.kind, args.conditionEpc, args.columns);
  return assembleStockWindow(gateway, args.columns, args.query);
}
