import { Router, type Request, type Response } from "express";
import type { ProjectStage } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { canSeeProject, clientForcedTab, includedTypeLabels, isAdmin, isClient, PROJECT_TABS } from "../lib/access.js";
import { buildSummary } from "../lib/summary.js";
import { userAccessIds } from "../middleware/auth.js";
import { formatDocDate } from "../lib/dates.js";
import { formatBytes } from "../lib/documents.js";
import { reapplyExternalLink } from "../lib/external.js";

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
  const boards = {
    current: visible.filter((p) => p.stage === "current"),
    upcoming: isAdmin(user) ? visible.filter((p) => p.stage === "upcoming") : [],
    archive: visible.filter((p) => p.stage === "archive"),
  };
  res.render("projects", {
    title: "Projects",
    user,
    boards,
    selectedId: String(req.query.selected || ""),
    notice: req.query.notice || "",
    error: req.query.error || "",
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
  await prisma.project.create({ data: { name, projectManager, stage, ...types } });
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
    data: { name, projectManager, stage, ...types },
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
      projectTargetPercent: src.projectTargetPercent,
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
  const requested = String(req.query.tab || (isClient(user) ? "completions" : "summary"));
  let tab = clientForcedTab(user, PROJECT_TABS.includes(requested as (typeof PROJECT_TABS)[number]) ? requested : "summary");
  if (tab === "loader" && !isAdmin(user)) tab = "summary";
  if (tab === "documents" && isClient(user)) tab = "completions";

  if (isAdmin(user)) {
    try {
      await reapplyExternalLink(project.id);
    } catch (err) {
      console.error("External re-apply on project view failed", err);
    }
  }

  const assets = await prisma.asset.findMany({
    where: { projectId: project.id },
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

  const summary = buildSummary(project, assets);
  const completions = await prisma.completion.findMany({
    where: { projectId: project.id },
    orderBy: { generatedAt: "desc" },
  });
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

  res.render("project", {
    title: project.name,
    user,
    project,
    tab,
    typesLine: includedTypeLabels(project),
    summary,
    assets: withAgency,
    dwellings: withAgency.filter((a) => a.kind === "dwelling"),
    blocks: withAgency.filter((a) => a.kind === "block"),
    garages: withAgency.filter((a) => a.kind === "garage"),
    completions,
    visitLogs,
    loaderHistory,
    documents,
    externalLink,
    flashRefresh,
    formatDocDate,
    formatBytes,
    notice: req.query.notice || "",
    error: req.query.error || "",
  });
});
