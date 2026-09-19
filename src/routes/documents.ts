import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { canManageDocuments, canSeeDocuments, canSeeProject } from "../lib/access.js";
import { userAccessIds } from "../middleware/auth.js";
import { ALLOWED_DOC_EXTS, extOf, projectFilePath, removeProjectFile, safeOriginalName, saveProjectFile } from "../lib/documents.js";

export const documentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

documentsRouter.post("/projects/:id/documents", upload.single("file"), async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canManageDocuments(user)) {
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
    res.redirect(`/projects/${project.id}?tab=documents&error=` + encodeURIComponent("Choose a file first."));
    return;
  }
  const ext = extOf(req.file.originalname);
  if (!ALLOWED_DOC_EXTS.includes(ext as (typeof ALLOWED_DOC_EXTS)[number])) {
    res.redirect(`/projects/${project.id}?tab=documents&error=` + encodeURIComponent("Use Excel, Word or PDF."));
    return;
  }
  const name = safeOriginalName(req.file.originalname);
  const storedName = `${randomUUID()}.${ext}`;
  await saveProjectFile(project.id, storedName, req.file.buffer);
  await prisma.projectDocument.create({
    data: {
      projectId: project.id,
      name,
      storedName,
      type: ext,
      size: req.file.size,
      uploadedBy: user.name,
    },
  });
  res.redirect(`/projects/${project.id}?tab=documents&notice=` + encodeURIComponent("Uploaded " + name));
});

documentsRouter.get("/projects/:id/documents/:docId/:action", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canSeeDocuments(user)) {
    res.status(403).send("Not available.");
    return;
  }
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).send("Project not found.");
    return;
  }
  const doc = await prisma.projectDocument.findFirst({
    where: { id: req.params.docId, projectId: project.id },
  });
  if (!doc) {
    res.status(404).send("Document not found.");
    return;
  }
  const dest = projectFilePath(project.id, doc.storedName);
  const disposition = req.params.action === "download" ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disposition}; filename="${doc.name.replace(/"/g, "")}"`);
  res.sendFile(dest, (err?: Error) => {
    if (err && !res.headersSent) res.status(404).send("File missing on disk. TODO: fetch from Spaces cloud-portal-vault.");
  });
});

documentsRouter.post("/projects/:id/documents/:docId/delete", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canManageDocuments(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) {
    res.status(404).send("Project not found.");
    return;
  }
  const doc = await prisma.projectDocument.findFirst({
    where: { id: req.params.docId, projectId: project.id },
  });
  if (doc) {
    await removeProjectFile(project.id, doc.storedName);
    await prisma.projectDocument.delete({ where: { id: doc.id } });
  }
  res.redirect(`/projects/${project.id}?tab=documents&notice=` + encodeURIComponent("Deleted document."));
});
