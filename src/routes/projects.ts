import { Router, type Request, type Response } from "express";
import type { ProjectStage } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  canEditSampleAnalysis,
  canSeeProject,
  canSeeProjectTab,
  defaultProjectTab,
  includedTypeLabels,
  isAdmin,
  isClient,
  isProjectTab,
  isSurveyor,
} from "../lib/access.js";
import { buildSummary } from "../lib/summary.js";
import { userAccessIds } from "../middleware/auth.js";
import { formatDocDate, formatStockDate } from "../lib/dates.js";
import { formatBytes } from "../lib/documents.js";
import { reapplyExternalLink } from "../lib/external.js";
import { parseProjectTarget } from "../lib/project-target.js";
import { ARCHIVE_BOARD_LIMIT, recentArchived, sortArchived } from "../lib/archive.js";
import { assetStatusFilterOptions } from "../lib/asset-status.js";
import { buildSampleAnalysis } from "../lib/sample-analysis.js";
import { buildCurrentProjectTileStats, type ProjectTileStats } from "../lib/project-tile-stats.js";
import { ADMIN_EDIT_STOCK_COLS, STOCK_DATE_COLS, STOCK_LABELS, STOCK_SELECT_COLS, stockColumns } from "../lib/stock-columns.js";
import { loadStockRows } from "../lib/stock-query.js";
import { assembleStockTab, stockKindFromTab, STOCK_PAGE_SIZE } from "../lib/stock-page.js";
import { listClientAccessFolders } from "../lib/photos.js";

export const projectsRouter = Router();

function readTypes(body: Record<string, unknown>) {
  const raw = body.types;
  const selected = new Set(Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []);
  return {
    typeConditionOnly: selected.has("typeConditionOnly"),
    typeConditionEpc: selected.has("typeConditionEpc"),
    typeBlocks: selected.has("typeBlocks"),
    typeGarages: selected.has("typeGarages"),
    typeCommercial: selected.has("typeCommercial"),
    typeOther: selected.has("typeOther"),
    typeValidations: selected.has("typeValidations"),
  };
}

function anyTypeOn(types: Record<string, boolean>): boolean {
  return Object.values(types).some(Boolean);
}

projectsRouter.get("/", async (req: Request, res: Response) => {
  const user = req.user!;
  const accessIds = await userAccessIds(user.id);
  const all = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });
  const visible = all.filter((p) => canSeeProject(user, p, accessIds));
  const archived = visible.filter((p) => p.stage === "archive");
  const boards = {
    current: visible.filter((p) => p.stage === "current"),
    upcoming: isAdmin(user) ? visible.filter((p) => p.stage === "upcoming") : [],
    archive: recentArchived(archived),
  };

  let tileStats: Record<string, ProjectTileStats> = {};
  if (isAdmin(user) && boards.current.length) {
    const currentIds = boards.current.map((p) => p.id);
    const assets = await prisma.asset.findMany({
      where: { projectId: { in: currentIds } },
      select: {
        projectId: true,
        kind: true,
        patch: true,
        omitAsset: true,
        assetStatus: true,
        surveyType: true,
        external: true,
        visit1: true,
        visit2: true,
        visit3: true,
      },
    });
    tileStats = Object.fromEntries(buildCurrentProjectTileStats(boards.current, assets));
  }

  res.render("projects", {
    title: "Projects",
    user,
    boards,
    tileStats,
    archiveTotal: archived.length,
    archiveLimit: ARCHIVE_BOARD_LIMIT,
    selectedId: String(req.query.selected || ""),
    notice: req.query.notice || "",
    error: req.query.error || "",
  });
});

projectsRouter.get("/archive", async (req: Request, res: Response) => {
  const user = req.user!;
  const accessIds = await userAccessIds(user.id);
  const all = await prisma.project.findMany({
    where: { stage: "archive" },
    orderBy: { updatedAt: "desc" },
  });
  const visible = all.filter((p) => canSeeProject(user, p, accessIds));
  const sortKeyRaw = String(req.query.sort || "updatedAt");
  const sortKey = sortKeyRaw === "name" || sortKeyRaw === "projectManager" ? sortKeyRaw : "updatedAt";
  const dir = req.query.dir === "asc" ? "asc" : "desc";
  const q = String(req.query.q || "").trim().toLowerCase();
  const filtered = q
    ? visible.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.projectManager.toLowerCase().includes(q)
      )
    : visible;
  res.render("archive", {
    title: "Projects Archive",
    user,
    projects: sortArchived(filtered, sortKey, dir),
    q: String(req.query.q || ""),
    sortKey,
    dir,
    notice: req.query.notice || "",
    error: req.query.error || "",
    formatDocDate,
  });
});

projectsRouter.post("/", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!isAdmin(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const name = String(req.body.name || "").trim();
  const projectManager = String(req.body.projectManager || "").trim() || "TBC";
  const stage = (req.body.stage === "current" ? "current" : "upcoming") as ProjectStage;
  const types = readTypes(req.body);
  const target = parseProjectTarget(req.body);
  if (!name) {
    res.redirect("/projects?error=" + encodeURIComponent("Enter a project name"));
    return;
  }
  if (!anyTypeOn(types)) {
    res.redirect("/projects?error=" + encodeURIComponent("Tick at least one survey type"));
    return;
  }
  const clash = await prisma.project.findUnique({ where: { name } });
  if (clash) {
    res.redirect("/projects?error=" + encodeURIComponent("Name already used"));
    return;
  }
  await prisma.project.create({ data: { name, projectManager, stage, ...types, ...target } });
  res.redirect("/projects?notice=" + encodeURIComponent("Created " + name));
});

projectsRouter.post("/:id/edit", async (req: Request, res: Response) => {
  if (!isAdmin(req.user!)) {
    res.status(403).send("Admin only.");
    return;
  }
  const name = String(req.body.name || "").trim();
  const projectManager = String(req.body.projectManager || "").trim() || "TBC";
  const stage = String(req.body.stage || "upcoming") as ProjectStage;
  const types = readTypes(req.body);
  const target = parseProjectTarget(req.body);
  if (!name || !anyTypeOn(types)) {
    res.redirect("/projects?error=" + encodeURIComponent("Name and at least one survey type are required"));
    return;
  }
  const clash = await prisma.project.findFirst({ where: { name, NOT: { id: req.params.id } } });
  if (clash) {
    res.redirect("/projects?error=" + encodeURIComponent("Name already used"));
    return;
  }
  await prisma.project.update({
    where: { id: req.params.id },
    data: { name, projectManager, stage, ...types, ...target },
  });
  res.redirect("/projects?notice=" + encodeURIComponent("Updated " + name));
});

projectsRouter.post("/:id/copy", async (req: Request, res: Response) => {
  if (!isAdmin(req.user!)) {
    res.status(403).send("Admin only.");
    return;
  }
  const src = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!src) {
    res.redirect("/projects?error=" + encodeURIComponent("Select a project first"));
    return;
  }
  let name = src.name + " copy";
  let n = 2;
  while (await prisma.project.findUnique({ where: { name } })) {
    name = src.name + " copy " + n++;
  }
  await prisma.project.create({
    data: {
      name,
      projectManager: src.projectManager,
      stage: "upcoming",
      typeConditionOnly: src.typeConditionOnly,
      typeConditionEpc: src.typeConditionEpc,
      typeBlocks: src.typeBlocks,
      typeGarages: src.typeGarages,
      typeCommercial: src.typeCommercial,
      typeOther: src.typeOther,
      typeValidations: src.typeValidations,
      projectTargetValue: src.projectTargetValue,
      projectTargetUnit: src.projectTargetUnit,
      sampleStartDate: src.sampleStartDate,
      sampleTargetEndDate: src.sampleTargetEndDate,
    },
  });
  res.redirect("/projects?notice=" + encodeURIComponent("Copied to " + name));
});

projectsRouter.post("/:id/delete", async (req: Request, res: Response) => {
  if (!isAdmin(req.user!)) {
    res.status(403).send("Admin only.");
    return;
  }
  const src = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!src) {
    res.redirect("/projects?error=" + encodeURIComponent("Select a project first"));
    return;
  }
  await prisma.project.delete({ where: { id: src.id } });
  res.redirect("/projects?notice=" + encodeURIComponent("Deleted " + src.name));
});

projectsRouter.post("/:id/stage", async (req: Request, res: Response) => {
  if (!isAdmin(req.user!)) {
    res.status(403).send("Admin only.");
    return;
  }
  const stage = String(req.body.stage || "") as ProjectStage;
  if (!["current", "upcoming", "archive"].includes(stage)) {
    res.redirect("/projects?error=" + encodeURIComponent("Invalid stage"));
    return;
  }
  await prisma.project.update({ where: { id: req.params.id }, data: { stage } });
  res.redirect("/projects");
});

projectsRouter.get("/:id", async (req: Request, res: Response) => {
  const user = req.user!;
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).send("Project not found.");
    return;
  }
  const requested = String(req.query.tab || "");
  const fallback = defaultProjectTab(user);
  const tab = isProjectTab(requested) ? requested : fallback;
  if (!canSeeProjectTab(user, tab)) {
    if (isClient(user)) {
      res.redirect(`/projects/${project.id}?tab=completions`);
      return;
    }
    if (isSurveyor(user) && tab === "completions") {
      res.status(403).send("Completions are not available.");
      return;
    }
    res.redirect(`/projects/${project.id}?tab=${fallback}`);
    return;
  }

  if (isAdmin(user)) {
    try {
      await reapplyExternalLink(project.id);
    } catch (err) {
      console.error("External re-apply on project view failed", err);
    }
  }

  const stockKind = stockKindFromTab(tab);
  const needsAssets = tab === "summary" || tab === "sample-analysis";
  // Counts only. A full Asset row per dwelling (address, letters, comments) is what
  // exhausted the small app instance when Summary opened on ~44k stock.
  const assets = needsAssets
    ? await prisma.asset.findMany({
        where: { projectId: project.id },
        select: {
          kind: true,
          omitAsset: true,
          assetStatus: true,
          surveyType: true,
          external: true,
          epcRequired: true,
          patch: true,
          surveyor: true,
          visit1: true,
          visit2: true,
          visit3: true,
        },
      })
    : [];
  const surveyors =
    tab === "sample-analysis"
      ? await prisma.user.findMany({
          where: { role: "surveyor" },
          select: { id: true, name: true, initials: true, agency: true },
        })
      : [];

  const summary = needsAssets ? buildSummary(project, assets) : [];
  let sample: ReturnType<typeof buildSampleAnalysis> & { canEdit: boolean } | null = null;
  if (tab === "sample-analysis") {
    const [patchMeta, accessRows] = await Promise.all([
      prisma.patchSample.findMany({ where: { projectId: project.id } }),
      prisma.projectAccess.findMany({
        where: { projectId: project.id },
        select: { userId: true },
      }),
    ]);
    const allocatedIds = new Set(accessRows.map((row) => row.userId));
    sample = {
      ...buildSampleAnalysis({
        assets,
        projectTargetValue: project.projectTargetValue,
        projectTargetUnit: project.projectTargetUnit,
        patchMeta,
        allocatedSurveyors: surveyors.filter((person) => allocatedIds.has(person.id)),
        knownSurveyors: surveyors,
      }),
      canEdit: canEditSampleAnalysis(user),
    };
  }
  const completions = await prisma.completion.findMany({
    where: { projectId: project.id },
    orderBy: { generatedAt: "desc" },
  });
  const photoFolders = tab === "completions" ? await listClientAccessFolders(project.id) : [];
  const visitLogs =
    tab === "loader"
      ? await prisma.visitLog.findMany({
          where: { projectId: project.id },
          orderBy: { loadedAt: "desc" },
          take: 500,
        })
      : [];
  const loaderHistory =
    tab === "loader"
      ? await prisma.loaderHistory.findMany({
          where: { projectId: project.id },
          orderBy: { when: "desc" },
          take: 20,
        })
      : [];
  const documents =
    tab === "documents"
      ? await prisma.projectDocument.findMany({
          where: { projectId: project.id },
          orderBy: { uploadedAt: "desc" },
        })
      : [];
  const externalLink = tab === "loader" ? await prisma.externalLink.findUnique({ where: { projectId: project.id } }) : null;
  const flashRefresh = req.session?.flashRefresh?.projectId === project.id ? req.session.flashRefresh : null;
  if (req.session?.flashRefresh?.projectId === project.id) {
    req.session.flashRefresh = undefined;
  }

  const includeEpcRequired = !!project.typeConditionEpc;
  const stockColsByKind = {
    dwelling: stockColumns("dwelling", { includeAdminOnly: isAdmin(user), includeEpcRequired }),
    block: stockColumns("block", { includeAdminOnly: isAdmin(user) }),
    garage: stockColumns("garage", { includeAdminOnly: isAdmin(user) }),
  };
  let stockRows: Awaited<ReturnType<typeof loadStockRows>> = [];
  let stockFilters: Record<string, string> = {};
  let stockFilterOptions: Record<string, string[]> = {};
  let stockPage = { page: 1, pageCount: 1, pageSize: STOCK_PAGE_SIZE, matched: 0, total: 0, from: 0, to: 0 };
  let stockSort = "uprn";
  let stockDir: "asc" | "desc" = "asc";
  let stockLabel = "0 of 0 Assets Displayed";
  let stockPagerText = "Page 1 of 1";
  if (stockKind) {
    const prepared = await loadStockRows(project.id, stockKind, includeEpcRequired);
    const tabModel = assembleStockTab(prepared, stockColsByKind[stockKind], req.query as Record<string, unknown>);
    stockRows = tabModel.page.rows;
    stockFilters = tabModel.listQuery.filters;
    stockFilterOptions = tabModel.filterOptions;
    stockPage = tabModel.page;
    stockSort = tabModel.page.sort;
    stockDir = tabModel.page.dir;
    stockLabel = tabModel.label;
    stockPagerText = tabModel.pagerLabel;
  }

  res.render("project", {
    title: project.name,
    user,
    project,
    tab,
    typesLine: includedTypeLabels(project),
    summary,
    stockKind,
    stockRows,
    stockFilters,
    stockFilterOptions,
    stockPage,
    stockSort,
    stockDir,
    stockLabel,
    stockPagerLabel: stockPagerText,
    stockPageSize: STOCK_PAGE_SIZE,
    stockFiltered: stockPage.total > 0 && stockPage.matched === 0,
    completions,
    photoFolders,
    visitLogs,
    loaderHistory,
    documents,
    externalLink,
    flashRefresh,
    formatDocDate,
    formatStockDate,
    formatBytes,
    stockLabels: STOCK_LABELS,
    stockSelectCols: STOCK_SELECT_COLS,
    assetStatusOptions: stockFilterOptions.assetStatus || assetStatusFilterOptions(),
    stockDateCols: STOCK_DATE_COLS,
    stockColsByKind,
    adminEditCols: isAdmin(user) ? [...ADMIN_EDIT_STOCK_COLS] : [],
    sample,
    notice: req.query.notice || "",
    error: req.query.error || "",
  });
});

function cleanAreaName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120);
}

function cleanInitials(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function cleanIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [year, month, day] = s.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return s;
}

async function loadEditableProject(req: Request, res: Response) {
  if (!canEditSampleAnalysis(req.user!)) {
    res.status(403).json({ error: "Admin only." });
    return null;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return null;
  }
  return project;
}

projectsRouter.post("/:id/sample-analysis/patch", async (req: Request, res: Response) => {
  const project = await loadEditableProject(req, res);
  if (!project) return;
  const patch = String(req.body.patch || "").trim().slice(0, 80);
  if (!patch) {
    res.status(400).json({ error: "Enter a patch." });
    return;
  }
  const hasArea = Object.prototype.hasOwnProperty.call(req.body, "areaName");
  const hasInitials = Object.prototype.hasOwnProperty.call(req.body, "surveyorInitials");
  if (!hasArea && !hasInitials) {
    res.status(400).json({ error: "Nothing to save." });
    return;
  }
  const existing = await prisma.patchSample.findUnique({
    where: { projectId_patch: { projectId: project.id, patch } },
  });
  const areaName = hasArea ? cleanAreaName(req.body.areaName) : existing?.areaName || "";
  const surveyorInitials = hasInitials ? cleanInitials(req.body.surveyorInitials) : existing?.surveyorInitials || "";
  await prisma.patchSample.upsert({
    where: { projectId_patch: { projectId: project.id, patch } },
    create: { projectId: project.id, patch, areaName, surveyorInitials },
    update: { areaName, surveyorInitials },
  });
  let updatedAssets = 0;
  if (hasInitials) {
    const rows = await prisma.asset.findMany({
      where: { projectId: project.id, omitAsset: false },
      select: { id: true, patch: true },
    });
    const ids = rows.filter((row) => row.patch.trim() === patch).map((row) => row.id);
    if (ids.length) {
      const updated = await prisma.asset.updateMany({
        where: { id: { in: ids } },
        data: { surveyor: surveyorInitials },
      });
      updatedAssets = updated.count;
    }
  }
  res.json({ ok: true, patch, areaName, surveyorInitials, updatedAssets });
});

projectsRouter.post("/:id/sample-analysis/schedule", async (req: Request, res: Response) => {
  const project = await loadEditableProject(req, res);
  if (!project) return;
  const data: { sampleStartDate?: string; sampleTargetEndDate?: string } = {};
  if (Object.prototype.hasOwnProperty.call(req.body, "sampleStartDate")) {
    const start = cleanIsoDate(req.body.sampleStartDate);
    if (start == null) {
      res.status(400).json({ error: "Start Date must be a real date." });
      return;
    }
    data.sampleStartDate = start;
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "sampleTargetEndDate")) {
    const end = cleanIsoDate(req.body.sampleTargetEndDate);
    if (end == null) {
      res.status(400).json({ error: "Target End Date must be a real date." });
      return;
    }
    data.sampleTargetEndDate = end;
  }
  if (!Object.keys(data).length) {
    res.status(400).json({ error: "Nothing to save." });
    return;
  }
  await prisma.project.update({ where: { id: project.id }, data });
  res.json({ ok: true, ...data });
});
