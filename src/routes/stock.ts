import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { canClearStock, canEditSiteComments, canExportStock, canOmitAsset, canPurgeMissingStock, canSeeProject, canSeeProjectTab, isAdmin } from "../lib/access.js";
import { applyMissingStockPurge, formatPurgeNotice } from "../lib/stock-purge.js";
import { ADMIN_EDIT_STOCK_COLS, STOCK_DATE_COLS, stockColumns } from "../lib/stock-columns.js";
import { formatStockDate } from "../lib/dates.js";
import { applyEpcSurveyType } from "../lib/epc-survey.js";
import { assembleStockTab } from "../lib/stock-page.js";
import { loadStockRows } from "../lib/stock-query.js";
import { userAccessIds } from "../middleware/auth.js";
import { buildStockWorkbook, parseExportScope, stockExportFilename } from "../lib/stock-export.js";

export const stockRouter = Router();

stockRouter.get("/projects/:id/stock/export", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canExportStock(user)) {
    res.status(403).send("Admin or surveyor only.");
    return;
  }
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).send("Project not found.");
    return;
  }
  const scope = parseExportScope(req.query.scope);
  const kinds = scope === "all" ? (["dwelling", "block", "garage"] as const) : [scope];
  const assets = await prisma.asset.findMany({
    where: { projectId: project.id, kind: { in: [...kinds] } },
    orderBy: [{ kind: "asc" }, { uprn: "asc" }],
  });
  const surveyors = await prisma.user.findMany({
    where: { role: "surveyor" },
    select: { initials: true, agency: true },
  });
  const agencyByInitials = new Map(
    surveyors.filter((s) => s.initials).map((s) => [s.initials!.toUpperCase(), s.agency || ""])
  );
  const withAgency = assets.map((a) => {
    const tokens = [a.surveyedBy, a.surveyor].map((x) => String(x || "").trim()).filter(Boolean);
    let agency = "";
    for (const token of tokens) {
      const hit = agencyByInitials.get(token.toUpperCase());
      if (hit) {
        agency = hit;
        break;
      }
    }
    return applyEpcSurveyType({ ...a, agency }, project.typeConditionEpc);
  });
  const groups = kinds.map((kind) => ({
    kind,
    rows: withAgency.filter((a) => a.kind === kind),
  }));
  const buf = buildStockWorkbook(groups, {
    includeAdminOnly: isAdmin(user),
    includeEpcRequired: project.typeConditionEpc,
  });
  const filename = stockExportFilename(project.name, scope);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
});

stockRouter.post("/projects/:id/stock/clear", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canClearStock(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.redirect("/projects?error=" + encodeURIComponent("Project not found"));
    return;
  }
  const confirm = String(req.body.confirm || "").trim();
  if (confirm !== "CLEAR") {
    res.redirect(
      `/projects/${project.id}?tab=loader&error=` +
        encodeURIComponent("Stocklist not cleared — type CLEAR to confirm.")
    );
    return;
  }
  const wipeVisitLog = req.body.wipeVisitLog === "true" || req.body.wipeVisitLog === "on";
  const deleted = await prisma.asset.deleteMany({ where: { projectId: project.id } });
  let visitNote = "";
  if (wipeVisitLog) {
    const logs = await prisma.visitLog.deleteMany({ where: { projectId: project.id } });
    visitNote = ` Visit log also cleared (${logs.count} row(s)).`;
  }
  await prisma.loaderHistory.create({
    data: {
      projectId: project.id,
      file: "—",
      target: "stock clear",
      result: `Cleared ${deleted.count} stock row(s).` + (wipeVisitLog ? " Visit log wiped." : " Visit log kept."),
    },
  });
  res.redirect(
    `/projects/${project.id}?tab=summary&notice=` +
      encodeURIComponent(`Cleared ${deleted.count} stock row(s). Summary counts updated.` + visitNote)
  );
});

stockRouter.post("/projects/:id/stock/purge-missing", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canPurgeMissingStock(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.redirect("/projects?error=" + encodeURIComponent("Project not found"));
    return;
  }
  const confirm = String(req.body.confirm || "").trim();
  if (confirm !== "REMOVE") {
    res.redirect(
      `/projects/${project.id}?tab=loader&error=` +
        encodeURIComponent("Assets not removed — confirm the purge first.")
    );
    return;
  }
  const includeCompleted =
    req.body.includeCompleted === "true" ||
    req.body.includeCompleted === "on" ||
    req.body.includeCompleted === "yes";
  const result = await applyMissingStockPurge({ projectId: project.id, includeCompleted });
  const notice = formatPurgeNotice(result);
  await prisma.loaderHistory.create({
    data: {
      projectId: project.id,
      file: "—",
      target: "stock purge missing",
      result:
        `Purged ${result.deleted} marked row(s)` +
        (includeCompleted ? " including completed." : ` · kept ${result.keptCompleted} completed.`),
    },
  });
  res.redirect(`/projects/${project.id}?tab=summary&notice=` + encodeURIComponent(notice));
});

function renderStockRows(res: Response, locals: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    res.app.render("partials/stock-rows", locals, (err, html) => {
      if (err) reject(err);
      else resolve(html || "");
    });
  });
}

function tabForKind(kind: "dwelling" | "block" | "garage"): string {
  if (kind === "block") return "blocks";
  if (kind === "garage") return "garages";
  return "dwellings";
}

stockRouter.get("/projects/:id/stock/page", async (req: Request, res: Response) => {
  const user = req.user!;
  const kindRaw = String(req.query.kind || "");
  const kind = kindRaw === "dwelling" || kindRaw === "block" || kindRaw === "garage" ? kindRaw : null;
  if (!kind) {
    res.status(400).json({ error: "Choose a stock tab." });
    return;
  }
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!canSeeProjectTab(user, tabForKind(kind))) {
    res.status(403).json({ error: "Not available." });
    return;
  }
  const includeEpcRequired = !!project.typeConditionEpc;
  const columns = stockColumns(kind, { includeAdminOnly: isAdmin(user), includeEpcRequired });
  const prepared = await loadStockRows(project.id, kind, includeEpcRequired);
  const tabModel = assembleStockTab(prepared, columns, req.query as Record<string, unknown>);
  const html = await renderStockRows(res, {
    rows: tabModel.page.rows,
    cols: columns,
    stockPageSize: tabModel.page.pageSize,
    stockFiltered: tabModel.stockFiltered,
    isAdmin: isAdmin(user),
    isSurveyor: user.role === "surveyor",
    formatStockDate,
    stockDateCols: STOCK_DATE_COLS,
    adminEditCols: isAdmin(user) ? [...ADMIN_EDIT_STOCK_COLS] : [],
  });
  res.json({
    ok: true,
    html,
    page: tabModel.page.page,
    pageCount: tabModel.page.pageCount,
    pageSize: tabModel.page.pageSize,
    from: tabModel.page.from,
    to: tabModel.page.to,
    matched: tabModel.page.matched,
    total: tabModel.page.total,
    sort: tabModel.page.sort,
    dir: tabModel.page.dir,
    label: tabModel.label,
    pagerLabel: tabModel.pagerLabel,
  });
});

stockRouter.patch("/projects/:id/assets/:assetId", async (req: Request, res: Response) => {
  const user = req.user!;
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const asset = await prisma.asset.findFirst({
    where: { id: req.params.assetId, projectId: project.id },
  });
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  const data: Record<string, string | boolean> = {};
  if (typeof req.body.siteComments === "string") {
    if (!canEditSiteComments(user)) {
      res.status(403).json({ error: "Surveyor or admin only." });
      return;
    }
    data.siteComments = req.body.siteComments;
  }
  if (typeof req.body.omitAsset === "boolean" || req.body.omitAsset === "true" || req.body.omitAsset === "false") {
    if (!canOmitAsset(user)) {
      res.status(403).json({ error: "Admin only." });
      return;
    }
    data.omitAsset = req.body.omitAsset === true || req.body.omitAsset === "true";
  }
  if (
    typeof req.body.epcRequired === "boolean" ||
    req.body.epcRequired === "true" ||
    req.body.epcRequired === "false"
  ) {
    if (!isAdmin(user)) {
      res.status(403).json({ error: "Admin only." });
      return;
    }
    if (asset.kind !== "dwelling") {
      res.status(400).json({ error: "EPC Req. is only on Dwellings." });
      return;
    }
    data.epcRequired = req.body.epcRequired === true || req.body.epcRequired === "true";
  }
  for (const col of ADMIN_EDIT_STOCK_COLS) {
    if (typeof req.body[col] !== "string") continue;
    if (!isAdmin(user)) {
      res.status(403).json({ error: "Admin only." });
      return;
    }
    if (asset.kind !== "dwelling") {
      res.status(400).json({ error: "Those fields are only on Dwellings." });
      return;
    }
    const raw = req.body[col];
    data[col] = STOCK_DATE_COLS.has(col) ? formatStockDate(raw) : raw;
  }
  const updated = await prisma.asset.update({ where: { id: asset.id }, data });
  res.json({ ok: true, asset: applyEpcSurveyType(updated, project.typeConditionEpc) });
});
