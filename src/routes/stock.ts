import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { canClearStock, canEditSiteComments, canExportStock, canOmitAsset, canSeeProject, isAdmin } from "../lib/access.js";
import { ADMIN_EDIT_STOCK_COLS, STOCK_DATE_COLS } from "../lib/stock-columns.js";
import { formatStockDate } from "../lib/dates.js";
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
    return { ...a, agency };
  });
  const groups = kinds.map((kind) => ({
    kind,
    rows: withAgency.filter((a) => a.kind === kind),
  }));
  const buf = buildStockWorkbook(groups, { includeAdminOnly: isAdmin(user) });
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
  res.json({ ok: true, asset: updated });
});
