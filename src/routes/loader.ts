import { Router } from "express";
import multer from "multer";
import type { AssetKind } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { canSeeProject, canUseLoader } from "../lib/access.js";
import { userAccessIds } from "../middleware/auth.js";
import { parseUprnWorkbook, parseWorkbook } from "../lib/excel.js";
import { applyVisitRows, type LoaderTarget } from "../lib/loader.js";
import { DEMO_VISIT_ROWS } from "../lib/demo-visits.js";
import { applyStocklistRefresh } from "../lib/stock-refresh.js";
import { flaggedUprnsFromRows, persistExternalLink, applyExternalUprnSet } from "../lib/external.js";

export const loaderRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function parseTarget(raw: unknown): LoaderTarget {
  const v = String(raw || "auto");
  if (v === "dwellings" || v === "dwelling") return "dwelling";
  if (v === "blocks" || v === "block") return "block";
  if (v === "garages" || v === "garage") return "garage";
  return "auto";
}

function stockRefreshKind(raw: unknown): AssetKind {
  const t = parseTarget(raw);
  return t === "auto" ? "dwelling" : t;
}

loaderRouter.post("/projects/:id/loader", upload.single("file"), async (req, res) => {
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

loaderRouter.post("/projects/:id/loader/demo", async (req, res) => {
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

loaderRouter.post("/projects/:id/stock-refresh", upload.single("file"), async (req, res) => {
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
  let rows;
  try {
    rows = parseUprnWorkbook(req.file.buffer, req.file.originalname);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent("Stocklist parse failed: " + msg));
    return;
  }
  const alsoOmit = req.body.omitRemoved === "true" || req.body.omitRemoved === "on";
  const kind = stockRefreshKind(req.body.target);
  const result = await applyStocklistRefresh({ projectId: project.id, kind, rows, alsoOmit });
  if (result.error) {
    res.redirect(`/projects/${project.id}?tab=loader&error=` + encodeURIComponent(result.error));
    return;
  }
  await prisma.loaderHistory.create({
    data: {
      projectId: project.id,
      file: req.file.originalname,
      target: `${kind} (stock refresh)`,
      result:
        `Added ${result.added.length} · Removed (marked) ${result.removed.length}` +
        (alsoOmit ? " · omitted from counts" : ""),
    },
  });
  req.session = req.session || {};
  req.session.flashRefresh = {
    projectId: project.id,
    added: result.added,
    removed: result.removed,
    alsoOmit,
    tab: kind,
  };
  res.redirect(
    `/projects/${project.id}?tab=loader&notice=` +
      encodeURIComponent(
        `Stocklist refresh applied to ${kind}: Added ${result.added.length}, Removed (marked) ${result.removed.length}` +
          (alsoOmit ? " (removed also omitted from counts)." : ".")
      )
  );
});

loaderRouter.post("/projects/:id/external", upload.single("file"), async (req, res) => {
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

loaderRouter.post("/projects/:id/external/clear", async (req, res) => {
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
