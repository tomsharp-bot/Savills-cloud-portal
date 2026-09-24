import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requireAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  buildPlaceholderZip,
  canonicalCodes,
  createPhotosExtract,
  deleteProjectPhotos,
  ensureProjectPhotoDemo,
  fileNameForCode,
  leadFirstName,
  listPhotoTiles,
  loadProjectPhotos,
  markFolderDownloaded,
  PHOTO_UPLOAD_CONCURRENCY,
  PHOTO_UPLOAD_MAX_BYTES,
  photoCodesOf,
  photoTooLargeMessage,
  readProjectPoolImage,
  renameProjectPhoto,
  replaceProjectPhotoCodes,
  setFolderClientAccess,
  spacesHint,
  uploadProjectPhoto,
  uprnFromCode,
  type PhotoMutationScope,
  type PoolImageResult,
} from "../lib/photos.js";
import {
  activePhotoShareSummary,
  issuePhotoShareToken,
  photoShareAddress,
  photoShareByCodeUrl,
  photoShareOrigin,
  revokePhotoShareTokens,
} from "../lib/photo-share.js";
import { seededSurveyTypes } from "../lib/programme.js";
import { fetchSpacesObject, spacesStatus } from "../lib/spaces.js";

export const photosRouter = Router();
photosRouter.use(requireAdmin);

/** Tests set this to stub Spaces reads. Production leaves it unset. */
export const POOL_IMAGE_READER = "poolImageReader";

type PoolObjectReader = (key: string) => Promise<Buffer | null>;

function poolObjectReader(req: Request): PoolObjectReader {
  const custom = req.app.get(POOL_IMAGE_READER);
  if (typeof custom === "function") return custom as PoolObjectReader;
  return fetchSpacesObject;
}

function inlineDisposition(fileName: string): string {
  const ascii =
    String(fileName || "photo")
      .replace(/[\r\n"]/g, "")
      .replace(/[^\x20-\x7E]/g, "_")
      .slice(0, 180) || "photo";
  return `inline; filename="${ascii}"`;
}

function sendPoolImage(res: Response, image: PoolImageResult): void {
  if (!image.ok) {
    res.status(image.status).type("text/plain; charset=utf-8").send(image.error);
    return;
  }
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", String(image.body.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", image.placeholder ? "private, no-store" : "private, no-cache");
  res.setHeader("Content-Disposition", inlineDisposition(image.fileName));
  res.status(200).send(image.body);
}

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_UPLOAD_MAX_BYTES, files: 1 },
});

function acceptPhotoUpload(req: Request, res: Response, next: NextFunction): void {
  photoUpload.single("file")(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ ok: false, error: photoTooLargeMessage() });
      return;
    }
    res.status(400).json({ ok: false, error: "Could not read that photo." });
  });
}

async function handlePhotoUpload(req: Request, res: Response, scope: PhotoMutationScope): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ ok: false, error: "Project not found." });
    return;
  }
  const file = req.file;
  if (!file || !file.buffer) {
    res.status(400).json({ ok: false, error: "Choose a photo to upload." });
    return;
  }
  // Spaces keys are derived from the project and the file name. Ignore any client key.
  const result = await uploadProjectPhoto(
    project.id,
    { originalName: file.originalname, buffer: file.buffer, mime: file.mimetype },
    scope
  );
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, photo: result.photo, folder: result.folder });
}

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
  const photoShare = await activePhotoShareSummary(project.id);
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
      poolDeleteApi: `/photos/projects/${project.id}/pool/delete`,
      poolRenameApi: `/photos/projects/${project.id}/pool/rename`,
      poolReplaceApi: `/photos/projects/${project.id}/pool/replace`,
      poolUploadApi: `/photos/projects/${project.id}/pool/upload`,
      photoShareApi: `/photos/projects/${project.id}/photo-share`,
      photoShare,
      uploadConcurrency: PHOTO_UPLOAD_CONCURRENCY,
      uploadMaxBytes: PHOTO_UPLOAD_MAX_BYTES,
    },
  });
});

function shareAddressPayload(req: Request, secret: string, expiresAt: Date, replaced: number) {
  const address = photoShareAddress(photoShareOrigin(req.protocol, req.get("host") || ""), secret);
  return {
    ok: true,
    address,
    expiresAt: expiresAt.toISOString(),
    byCodeExample: photoShareByCodeUrl(address, "635569-Front Door1"),
    replaced,
  };
}

photosRouter.post("/projects/:id/photo-share", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ ok: false, error: "Project not found." });
    return;
  }
  const issued = await issuePhotoShareToken({
    projectId: project.id,
    createdBy: req.user?.id || "",
    label: String(req.body?.label ?? ""),
    replaceExisting: false,
  });
  res.json(shareAddressPayload(req, issued.secret, issued.expiresAt, issued.replaced));
});

photosRouter.post("/projects/:id/photo-share/renew", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ ok: false, error: "Project not found." });
    return;
  }
  const issued = await issuePhotoShareToken({
    projectId: project.id,
    createdBy: req.user?.id || "",
    label: String(req.body?.label ?? ""),
    replaceExisting: true,
  });
  res.json(shareAddressPayload(req, issued.secret, issued.expiresAt, issued.replaced));
});

photosRouter.post("/projects/:id/photo-share/revoke", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ ok: false, error: "Project not found." });
    return;
  }
  const revoked = await revokePhotoShareTokens(project.id);
  res.json({ ok: true, revoked, active: false });
});

async function handlePhotoReplace(req: Request, res: Response, scope: PhotoMutationScope): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ ok: false, error: "Project not found." });
    return;
  }
  const result = await replaceProjectPhotoCodes(
    project.id,
    String(req.body?.find ?? ""),
    String(req.body?.replace ?? ""),
    readCodes(req.body),
    scope
  );
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({
    ok: true,
    renamed: result.renamed,
    skipped: result.skipped,
    renamedCount: result.renamed.length,
    skippedCount: result.skipped.length,
  });
}

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

function codesFromQuery(query: Request["query"]): string[] {
  const raw = query.codes ?? query.code;
  if (Array.isArray(raw)) return raw.map((c) => String(c).trim()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function readCodes(body: unknown): string[] {
  if (!body || typeof body !== "object" || !("codes" in body)) return [];
  const raw = (body as { codes?: unknown }).codes;
  if (Array.isArray(raw)) return raw.map((c) => String(c));
  if (typeof raw === "string") return raw.split(",");
  return [];
}

function placeholderZipFiles(
  label: string,
  ordered: Array<{ code: string; fileName: string; spacesKey: string }>
): Array<{ name: string; body: string }> {
  return ordered.map((item) => {
    const code = item.code;
    const fileName = (item.fileName || fileNameForCode(code)).replace(/\.jpg$/i, ".txt");
    const body =
      `Savills Cloud Portal · ${label}\n` +
      `File: ${item.fileName || fileNameForCode(code)}\n` +
      `UPRN: ${uprnFromCode(code)}\n` +
      `Code: ${code}\n` +
      `Spaces key: ${item.spacesKey || "(placeholder — Spaces not wired)"}\n` +
      `Live build will pack the real JPEG/PNG bytes from Spaces.\n`;
    return { name: fileName, body };
  });
}

function sendZip(res: Response, filename: string, files: Array<{ name: string; body: string }>): void {
  const zip = buildPlaceholderZip(files);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(zip);
}

photosRouter.get("/projects/:id/pool/:code/image", async (req: Request, res: Response) => {
  const image = await readProjectPoolImage(req.params.id, req.params.code, poolObjectReader(req));
  sendPoolImage(res, image);
});

photosRouter.get("/projects/:id/pool/download-zip", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).send("Project not found.");
    return;
  }
  const codes = codesFromQuery(req.query);
  if (!codes.length) {
    res.status(400).send("Select at least one photo.");
    return;
  }
  const pool = await prisma.photoPoolItem.findMany({
    where: { projectId: project.id, code: { in: codes } },
  });
  const byCode = new Map(pool.map((p) => [p.code.toUpperCase(), p]));
  const ordered = codes
    .map((c) => byCode.get(c.toUpperCase()))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({
      code: item.code,
      fileName: item.fileName || fileNameForCode(item.code),
      spacesKey: item.spacesKey || "",
    }));
  if (!ordered.length) {
    res.status(404).send("No matching photos in the pool.");
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${project.name.replace(/\s+/g, "-")}-selected-${stamp}.zip`;
  sendZip(res, filename, placeholderZipFiles("Photos Pool", ordered));
});

photosRouter.post("/projects/:id/pool/upload", acceptPhotoUpload, async (req: Request, res: Response) => {
  await handlePhotoUpload(req, res, { kind: "pool" });
});

photosRouter.post("/projects/:id/pool/delete", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const result = await deleteProjectPhotos(project.id, readCodes(req.body), { kind: "pool" });
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error, deletedCodes: result.deletedCodes });
    return;
  }
  res.json({ ok: true, deletedCodes: result.deletedCodes });
});

photosRouter.post("/projects/:id/pool/replace", async (req: Request, res: Response) => {
  await handlePhotoReplace(req, res, { kind: "pool" });
});

photosRouter.post("/projects/:id/pool/rename", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const result = await renameProjectPhoto(
    project.id,
    String(req.body?.code ?? ""),
    String(req.body?.name ?? ""),
    { kind: "pool" }
  );
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, photo: result.photo, previousCode: result.previousCode });
});

photosRouter.post(
  "/projects/:id/folders/:folderId/photos/upload",
  acceptPhotoUpload,
  async (req: Request, res: Response) => {
    await handlePhotoUpload(req, res, { kind: "folder", folderId: req.params.folderId });
  }
);

photosRouter.post("/projects/:id/folders/:folderId/photos/delete", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const result = await deleteProjectPhotos(project.id, readCodes(req.body), {
    kind: "folder",
    folderId: req.params.folderId,
  });
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error, deletedCodes: result.deletedCodes });
    return;
  }
  res.json({ ok: true, deletedCodes: result.deletedCodes });
});

photosRouter.post("/projects/:id/folders/:folderId/photos/replace", async (req: Request, res: Response) => {
  await handlePhotoReplace(req, res, { kind: "folder", folderId: req.params.folderId });
});

photosRouter.post("/projects/:id/folders/:folderId/photos/rename", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  const result = await renameProjectPhoto(
    project.id,
    String(req.body?.code ?? ""),
    String(req.body?.name ?? ""),
    { kind: "folder", folderId: req.params.folderId }
  );
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, photo: result.photo, previousCode: result.previousCode });
});

photosRouter.get("/projects/:id/folders/:folderId/photos/download-zip", async (req: Request, res: Response) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).send("Project not found.");
    return;
  }
  const folder = await prisma.photoFolder.findFirst({
    where: { id: req.params.folderId, projectId: project.id },
  });
  if (!folder || folder.kind === "zip") {
    res.status(404).send("Folder not found.");
    return;
  }
  const resolved = canonicalCodes(
    codesFromQuery(req.query),
    photoCodesOf(folder),
    "One or more photos are not in this folder."
  );
  if (!resolved.ok) {
    res.status(400).send(resolved.error);
    return;
  }
  const pool = await prisma.photoPoolItem.findMany({
    where: { projectId: project.id, code: { in: resolved.codes } },
  });
  const byCode = new Map(pool.map((p) => [p.code.toUpperCase(), p]));
  const ordered = resolved.codes.map((code) => {
    const item = byCode.get(code.toUpperCase());
    return {
      code: item?.code || code,
      fileName: item?.fileName || fileNameForCode(code),
      spacesKey: item?.spacesKey || "",
    };
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${project.name.replace(/\s+/g, "-")}-folder-selected-${stamp}.zip`;
  sendZip(res, filename, placeholderZipFiles("Photo Folder", ordered));
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
