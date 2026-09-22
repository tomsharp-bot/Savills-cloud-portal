import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { canSeeProject, canUseLoader } from "../lib/access.js";
import { userAccessIds } from "../middleware/auth.js";
import { parseStockWorkbook, parseUprnWorkbook, parseWorkbook } from "../lib/excel.js";
import { applyVisitRows, type LoaderTarget } from "../lib/loader.js";
import { DEMO_VISIT_ROWS } from "../lib/demo-visits.js";
import {
  STOCK_UPLOAD_MAX_BYTES,
  applyStocklistRefresh,
  buildStockRefreshFlash,
  formatStockRefreshResult,
} from "../lib/stock-refresh.js";
import { flaggedUprnsFromRows, persistExternalLink, applyExternalUprnSet } from "../lib/external.js";

export const loaderRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: STOCK_UPLOAD_MAX_BYTES } });

function stockUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "LIMIT_FILE_SIZE") {
      const id = req.params.id || "";
      res.redirect(
        `/projects/${id}?tab=loader&error=` +
          encodeURIComponent("That file is larger than 64MB. Save a slimmer workbook, or split it, then try again.")
      );
      return;
    }
    next(err);
  });
}

function parseTarget(raw: unknown): LoaderTarget {
  const v = String(raw || "auto");
  if (v === "dwellings" || v === "dwelling") return "dwelling";
  if (v === "blocks" || v === "block") return "block";
  if (v === "garages" || v === "garage") return "garage";
  return "auto";
}

loaderRouter.post("/projects/:id/loader", stockUpload, async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canUseLoader(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).send("Project not found.");
    return;
  }
  if (!req.file) {
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("Choose a file first."));
    return;
  }
  const target = parseTarget(req.body.target);
  let rows;
  try {
    rows = parseWorkbook(req.file.buffer, req.file.originalname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("Parse failed: " + msg));
    return;
  }
  if (!rows.length) {
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("No data rows found in file."));
    return;
  }
  const result = await applyVisitRows({
    projectId: project.id,
    rows,
    target,
    filename: req.file.originalname,
  });
  await prisma.loaderHistory.create({
    data: {
      projectId: project.id,
      file: req.file.originalname,
      target,
      result:
        `${result.appended} visit(s) appended · ${result.touched} stock row(s) updated` +
        ` · D ${result.byTab.dwelling} / B ${result.byTab.block} / G ${result.byTab.garage}` +
        (result.newSuccessful ? ` · +${result.newSuccessful} Full Survey` : ""),
    },
  });
  res.redirect(
    `/projects/${project.id}?tab=loader&notice=` +
      encodeURIComponent(`Applied ${result.appended} visit(s) from ${req.file.originalname}.`)
  );
});

loaderRouter.post("/projects/:id/loader/demo", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canUseLoader(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).send("Project not found.");
    return;
  }
  const target = parseTarget(req.body.target);
  const result = await applyVisitRows({
    projectId: project.id,
    rows: DEMO_VISIT_ROWS,
    target,
    filename: "demo-sample-daily-export.xlsx",
  });
  await prisma.loaderHistory.create({
    data: {
      projectId: project.id,
      file: "demo-sample-daily-export.xlsx",
      target,
      result:
        `${result.appended} visit(s) appended · ${result.touched} stock row(s) updated` +
        ` · D ${result.byTab.dwelling} / B ${result.byTab.block} / G ${result.byTab.garage}` +
        (result.newSuccessful ? ` · +${result.newSuccessful} Full Survey` : ""),
    },
  });
  res.redirect(
    `/projects/${project.id}?tab=loader&notice=` +
      encodeURIComponent(
        "Loaded demo visits (covers No Access, Appt Made Not Kept, Access Refused, Void, Full Survey, plus Block/Garage auto-route)."
      )
  );
});

loaderRouter.post("/projects/:id/stock-refresh", stockUpload, async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canUseLoader(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).send("Project not found.");
    return;
  }
  if (!req.file) {
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("Choose a stocklist file first."));
    return;
  }
  let parsed;
  try {
    parsed = parseStockWorkbook(req.file.buffer, req.file.originalname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("Stocklist parse failed: " + msg));
    return;
  }
  req.file.buffer = Buffer.alloc(0);
  const rows = parsed.rows;
  req.setTimeout(0);
  res.setTimeout(0);
  const alsoOmit = req.body.omitRemoved === "true" || req.body.omitRemoved === "on";
  const target = parseTarget(req.body.target);
  let result;
  try {
    result = await applyStocklistRefresh({ projectId: project.id, target, rows, alsoOmit });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent(msg.slice(0, 500)));
    return;
  }
  if (result.error) {
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent(result.error));
    return;
  }
  const resultText = formatStockRefreshResult({
    addedByTab: result.addedByTab,
    removedCount: result.removed.length,
    movedCount: result.moved,
    alsoOmit,
    rows,
    addedUprns: result.added,
    target,
    fileRows: result.fileRows,
    uniqueUprn: result.uniqueUprn,
    blankUprn: result.blankUprn,
    duplicateUprn: result.duplicateUprn,
    fileByTab: result.fileByTab,
    sheets: parsed.sheets,
    warnings: parsed.warnings,
    storedAssets: result.storedAssets,
  });
  await prisma.loaderHistory.create({
    data: {
      projectId: project.id,
      file: req.file.originalname,
      target: `${target} (stock refresh)`,
      result: resultText,
    },
  });
  req.session = req.session || {};
  req.session.flashRefresh = buildStockRefreshFlash({
    projectId: project.id,
    added: result.added,
    removed: result.removed,
    addedByTab: result.addedByTab,
    alsoOmit,
    tab: target,
    stats: result,
    storedAssets: result.storedAssets,
  });
  res.redirect(
    `/projects/${project.id}?tab=loader&notice=` + encodeURIComponent(`Stocklist refresh: ${resultText}.`)
  );
});

loaderRouter.post("/projects/:id/external", stockUpload, async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canUseLoader(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).send("Project not found.");
    return;
  }
  if (!req.file) {
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("Choose an External list file first."));
    return;
  }
  let rows;
  try {
    rows = parseUprnWorkbook(req.file.buffer, req.file.originalname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("External list parse failed: " + msg));
    return;
  }
  const flagCol = String(req.body.flagCol || "External").trim() || "External";
  const uprns = flaggedUprnsFromRows(rows, flagCol);
  await persistExternalLink({
    projectId: project.id,
    fileName: req.file.originalname,
    flagCol,
    uprns,
  });
  const applied = await applyExternalUprnSet(project.id, uprns);
  res.redirect(
    `/projects/${project.id}?tab=loader&notice=` +
      encodeURIComponent(
        `Linked ${req.file.originalname}: ${applied.flagged} flagged UPRN(s), ${applied.matched} stock row(s) Ext-Only. Visit dates unchanged.`
      )
  );
});

loaderRouter.post("/projects/:id/external/clear", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canUseLoader(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  await prisma.externalLink.deleteMany({ where: { projectId: req.params.id } });
  res.redirect(
    `/projects/${req.params.id}?tab=loader&notice=` +
      encodeURIComponent("External link cleared. Existing External / Ext-Only flags stay until you overwrite them.")
  );
});
