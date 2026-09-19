import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { canSeeProject, canUseLoader } from "../lib/access.js";
import { userAccessIds } from "../middleware/auth.js";
import { parseWorkbook } from "../lib/excel.js";
import { applyVisitRows, type LoaderTarget } from "../lib/loader.js";
import { DEMO_VISIT_ROWS } from "../lib/demo-visits.js";

export const loaderRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function parseTarget(raw: unknown): LoaderTarget {
  const v = String(raw || "auto");
  if (v === "dwellings" || v === "dwelling") return "dwelling";
  if (v === "blocks" || v === "block") return "block";
  if (v === "garages" || v === "garage") return "garage";
  return "auto";
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
      encodeURIComponent("Loaded demo visits (covers No Access, Appt Made Not Kept, Access Refused, Void, Full Survey, plus Block/Garage auto-route).")
  );
});

/** Stub — mid-job stocklist refresh is out of scope for this slice. */
loaderRouter.post("/projects/:id/stock-refresh", (_req, res) => {
  res.status(501).json({
    error: "Stocklist refresh is stubbed in this slice. See README TODO.",
  });
});
