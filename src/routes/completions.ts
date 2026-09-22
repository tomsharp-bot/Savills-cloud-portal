import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { canSeeCompletions, canSeeProject } from "../lib/access.js";
import { userAccessIds } from "../middleware/auth.js";
import {
  buildPlaceholderZip,
  fileNameForCode,
  markFolderDownloaded,
  photoCodesOf,
  uprnFromCode,
} from "../lib/photos.js";

export const completionsRouter = Router();

completionsRouter.get("/projects/:id/completions/:compId/:action", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canSeeCompletions(user)) {
    res.status(403).send("Completions are not available.");
    return;
  }
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).send("Project not found.");
    return;
  }
  const comp = await prisma.completion.findFirst({
    where: { id: req.params.compId, projectId: project.id },
  });
  if (!comp) {
    res.status(404).send("Report not found.");
    return;
  }
  const body = `Savills Cloud Portal — ${comp.name}\nProject: ${project.name}\nType: ${comp.type}\nStatus: ${comp.status}\n\n(Stub file — live generation and Spaces download come later.)\n`;
  const filename = `${comp.name.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_")}.txt`;
  if (req.params.action === "download") {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.type("text/plain").send(body);
});

/** Photo Folders with Client Access — download from Project Progress Completions. */
completionsRouter.get("/projects/:id/photo-folders/:folderId/download", async (req: Request, res: Response) => {
  const user = req.user!;
  if (!canSeeCompletions(user)) {
    res.status(403).send("Completions are not available.");
    return;
  }
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).send("Project not found.");
    return;
  }
  const folder = await prisma.photoFolder.findFirst({
    where: { id: req.params.folderId, projectId: project.id, clientAccess: true },
  });
  if (!folder) {
    res.status(404).send("Photo folder not found.");
    return;
  }
  const codes = photoCodesOf(folder);
  const files =
    codes.length > 0
      ? codes.map((code) => ({
          name: fileNameForCode(code).replace(/\.jpg$/i, ".txt"),
          body:
            `Savills Cloud Portal · Photo Folder\n` +
            `Folder: ${folder.name}\n` +
            `Project: ${project.name}\n` +
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
              `Project: ${project.name}\n` +
              `Size: ${folder.sizeLabel || "n/a"}\n` +
              `Placeholder pack — live Spaces download comes later.\n`,
          },
        ];
  const zip = buildPlaceholderZip(files);
  const who = user.company
    ? `Client portal · ${user.company}`
    : `Client portal · ${user.name || user.username}`;
  await markFolderDownloaded(folder.id, who, user.id);
  const filename = `${project.name.replace(/\s+/g, "_")}_${folder.name.replace(/[^\w.\- ]+/g, "_").slice(0, 60)}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(zip);
});
