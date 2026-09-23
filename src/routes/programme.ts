import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  PROGRAMME_BOARD_ID,
  boardFromClient,
  buildProgrammeTables,
  jsonForScript,
  parseSavedBoard,
  programmeNotes,
  resolveProgramme,
  seededSurveyTypes,
  surveyTypesForSave,
} from "../lib/programme.js";
import {
  buildProgrammeWorkbook,
  parseProgrammeExport,
  programmeContentDisposition,
} from "../lib/programme-export.js";

export const programmeRouter = Router();
programmeRouter.use(requireAdmin);

programmeRouter.get("/", async (req: Request, res: Response) => {
  const [projects, surveyors, admins, boardRow, notes, stockGroups] = await Promise.all([
    prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({
      where: { role: "surveyor" },
      orderBy: { name: "asc" },
      select: { name: true, agency: true, frozen: true },
    }),
    prisma.user.findMany({
      where: { role: "admin" },
      orderBy: { name: "asc" },
      select: { name: true, agency: true, frozen: true },
    }),
    prisma.programmeBoard.findUnique({ where: { id: PROGRAMME_BOARD_ID } }),
    prisma.programmeSurveyNote.findMany(),
    prisma.asset.groupBy({ by: ["projectId"], _count: { _all: true } }),
  ]);

  const resolved = resolveProgramme({
    saved: boardRow ? parseSavedBoard(boardRow.data) : null,
    surveyors,
    admins,
  });
  const noteMap = new Map(notes.map((note) => [note.projectId, note.surveyTypes]));
  const stock = new Map(stockGroups.map((row) => [row.projectId, row._count._all]));
  const tables = buildProgrammeTables(projects, stock, noteMap);
  const payload = {
    weeks: resolved.weeks,
    rows: resolved.rows,
    admins: resolved.admins,
    pools: resolved.pools,
    ticks: resolved.ticks,
    applied: resolved.applied,
    projects: {
      current: tables.current,
      upcoming: tables.upcoming,
      completed: tables.completed,
    },
    notes: programmeNotes(resolved.usingPersonnelAdmins),
    adminNames: admins.map((person) => person.name),
    saveUrl: res.locals.baseUrl("/projects-programme/board"),
    scopeUrl: res.locals.baseUrl("/projects-programme/survey-types"),
    exportUrl: res.locals.baseUrl("/projects-programme/export"),
  };

  res.render("projects-programme", {
    title: "Projects Programme",
    user: req.user,
    programmeJson: jsonForScript(payload),
    usingPersonnelAdmins: resolved.usingPersonnelAdmins,
  });
});

programmeRouter.post("/board", async (req: Request, res: Response) => {
  const saved = boardFromClient(req.body);
  if (!saved) {
    res.status(400).json({ error: "Board payload was not valid." });
    return;
  }
  await prisma.programmeBoard.upsert({
    where: { id: PROGRAMME_BOARD_ID },
    create: { id: PROGRAMME_BOARD_ID, data: saved, updatedBy: req.user?.id || "" },
    update: { data: saved, updatedBy: req.user?.id || "" },
  });
  res.json({ ok: true });
});

programmeRouter.post("/export", async (req: Request, res: Response) => {
  const parsed = parseProgrammeExport(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Export payload was not valid." });
    return;
  }
  const workbook = await buildProgrammeWorkbook(parsed);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", programmeContentDisposition(workbook.filename));
  res.send(workbook.buffer);
});

programmeRouter.post("/survey-types", async (req: Request, res: Response) => {
  const projectId = String(req.body?.projectId || "").trim();
  if (!projectId) {
    res.status(400).json({ error: "Missing project." });
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const parsed = surveyTypesForSave(seededSurveyTypes(project), req.body?.surveyTypes);
  if (!parsed) {
    res.status(400).json({ error: "Survey types must be text." });
    return;
  }
  if (parsed.clear) {
    await prisma.programmeSurveyNote.deleteMany({ where: { projectId } });
  } else {
    await prisma.programmeSurveyNote.upsert({
      where: { projectId },
      create: { projectId, surveyTypes: parsed.text },
      update: { surveyTypes: parsed.text },
    });
  }
  res.json({ ok: true, surveyTypes: parsed.text });
});
