import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  buildPlaceholderZip,
  createPhotosExtract,
  ensureProjectPhotoDemo,
  fileNameForCode,
  leadFirstName,
  listPhotoTiles,
  loadProjectPhotos,
  markFolderDownloaded,
  photoCodesOf,
  setFolderClientAccess,
  spacesHint,
  uprnFromCode,
} from "../lib/photos.js";
import { seededSurveyTypes } from "../lib/programme.js";
import { spacesStatus } from "../lib/spaces.js";

export const photosRouter = Router();
photosRouter.use(requireAdmin);

async function surveyNoteMap(): Promise<Map<string, string>> {
  const notes = await prisma.programmeSurveyNote.findMany();
  return new Map(notes.map((n) => [n.projectId, n.surveyTypes]));
}

photosRouter.get("/", async (req: Request, res: Response) => {
  const projects = await prisma.project.findMany({
    where: { stage: "current" },
    orderBy: { createdAt: "asc" },
  });
  const tiles = await listPhotoTiles(projects, await surveyNoteMap());
  res.render("photos", {
    title: "Photo Storage",
    user: req.user,
    tiles,
    spacesHint: spacesHint(),
    spacesConfigured: spacesStatus().configured,
    view: "current",
  });
});

photosRouter.get("/archived", async (req: Request, res: Response) => {
  const projects = await prisma.project.findMany({
    where: { stage: "archive" },
    orderBy: { updatedAt: "desc" },
  });
  const tiles = await listPhotoTiles(projects, await surveyNoteMap());
  res.render("photos-archived", {
    title: "Photo Storage — Archived",
    user: req.user,
    tiles,
    spacesHint: spacesHint(),
    spacesConfigured: spacesStatus().configured,
    view: "archived",
  });
});

photosRouter.get("/projects/:id", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || (project.stage !== "current" && project.stage !== "archive")) {
    res.status(404).send("Project not found.");
    return;
  }
  await ensureProjectPhotoDemo(project);
  const notes = await surveyNoteMap();
  const surveyTypes = notes.has(project.id)
    ? String(notes.get(project.id) ?? "")
    : seededSurveyTypes(project);
  const { pool, folders } = await loadProjectPhotos(project.id);
  const from = project.stage === "archive" ? "archived" : "current";
  res.render("photos-project", {
    title: `${project.name} — Photos`,
    user: req.user,
    project,
    leadFirst: leadFirstName(project.projectManager),
    surveyTypes,
    from,
    pool,
    folders,
    spacesHint: spacesHint(),
    spacesConfigured: spacesStatus().configured,
    bootstrap: {
      projectId: project.id,
      projectName: project.name,
      pool,
      folders,
      extractApi: `/photos/projects/${project.id}/extract`,
      clientAccessApiBase: `/photos/projects/${project.id}/folders`,
      zipApi: `/photos/projects/${project.id}/pool/download-zip`,
    },
  });
});

photosRouter.post("/projects/:id/extract", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  await ensureProjectPhotoDemo(project);
  const result = await createPhotosExtract(
    project.id,
    String(req.body?.codes ?? ""),
    String(req.body?.nameRest ?? "")
  );
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, ...result.result });
});

photosRouter.post("/projects/:id/folders/:folderId/client-access", async (req: Request, res: Response) => {
  const clientAccess = !!req.body?.clientAccess;
  const updated = await setFolderClientAccess(req.params.folderId, req.params.id, clientAccess);
  if (!updated.count) {
    res.status(404).json({ error: "Folder not found." });
    return;
  }
  res.json({ ok: true, clientAccess });
});

photosRouter.get("/projects/:id/pool/download-zip", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).send("Project not found.");
    return;
  }
  const raw = String(req.query.codes || "");
  const codes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!codes.length) {
    res.status(400).send("Select at least one photo.");
    return;
  }
  const pool = await prisma.photoPoolItem.findMany({
    where: { projectId: project.id, code: { in: codes } },
  });
  const byCode = new Map(pool.map((p) => [p.code.toUpperCase(), p]));
  const files = codes
    .map((c) => byCode.get(c.toUpperCase()))
    .filter(Boolean)
    .map((item) => {
      const code = item!.code;
      const fileName = (item!.fileName || fileNameForCode(code)).replace(/\.jpg$/i, ".txt");
      const body =
        `Savills Cloud Portal · Photos Pool\n` +
        `File: ${item!.fileName || fileNameForCode(code)}\n` +
        `UPRN: ${uprnFromCode(code)}\n` +
        `Code: ${code}\n` +
        `Spaces key: ${item!.spacesKey || "(placeholder — Spaces not wired)"}\n` +
        `Live build will pack the real JPEG/PNG bytes from Spaces.\n`;
      return { name: fileName, body };
    });
  if (!files.length) {
    res.status(404).send("No matching photos in the pool.");
    return;
  }
  const zip = buildPlaceholderZip(files);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${project.name.replace(/\s+/g, "-")}-selected-${stamp}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(zip);
});

photosRouter.get("/projects/:id/folders/:folderId/download", async (req: Request, res: Response) => {
  const folder = await prisma.photoFolder.findFirst({
    where: { id: req.params.folderId, projectId: req.params.id },
  });
  if (!folder) {
    res.status(404).send("Folder not found.");
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  const codes = photoCodesOf(folder);
  const files =
    codes.length > 0
      ? codes.map((code) => ({
          name: fileNameForCode(code).replace(/\.jpg$/i, ".txt"),
          body:
            `Savills Cloud Portal · Photo Folder\n` +
            `Folder: ${folder.name}\n` +
            `Code: ${code}\n` +
            `UPRN: ${uprnFromCode(code)}\n` +
            `Placeholder until Spaces bytes are available.\n`,
        }))
      : [
          {
            name: `${folder.name.replace(/[^\w.\- ]+/g, "_")}.txt`,
            body:
              `Savills Cloud Portal · Photo Folder / zip\n` +
              `Name: ${folder.name}\n` +
              `Size: ${folder.sizeLabel || "n/a"}\n` +
              `Placeholder pack — live Spaces download comes later.\n`,
          },
        ];
  const zip = buildPlaceholderZip(files);
  const who = req.user?.company
    ? `Client portal · ${req.user.company}`
    : `Client portal · ${req.user?.name || "Admin"}`;
  await markFolderDownloaded(folder.id, who, req.user?.id || "");
  const filename = `${(project?.name || "photos").replace(/\s+/g, "_")}_${folder.name.replace(/[^\w.\- ]+/g, "_").slice(0, 60)}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(zip);
});
