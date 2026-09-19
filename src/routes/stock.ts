import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { canEditSiteComments, canOmitAsset, canSeeProject } from "../lib/access.js";
import { userAccessIds } from "../middleware/auth.js";

export const stockRouter = Router();

stockRouter.patch("/projects/:id/assets/:assetId", async (req, res) => {
  const user = req.user!;
  const accessIds = await userAccessIds(user.id);
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || !canSeeProject(user, project, accessIds)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const asset = await prisma.asset.findFirst({
    where: { id: req.params.assetId, projectId: project.id },
  });
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  const data: { siteComments?: string; omitAsset?: boolean } = {};
  if (typeof req.body.siteComments === "string") {
    if (!canEditSiteComments(user)) {
      res.status(403).json({ error: "Surveyor or admin only." });
      return;
    }
    data.siteComments = req.body.siteComments;
  }
  if (typeof req.body.omitAsset === "boolean" || req.body.omitAsset === "true" || req.body.omitAsset === "false") {
    if (!canOmitAsset(user)) {
      res.status(403).json({ error: "Admin only." });
      return;
    }
    data.omitAsset = req.body.omitAsset === true || req.body.omitAsset === "true";
  }
  const updated = await prisma.asset.update({ where: { id: asset.id }, data });
  res.json({ ok: true, asset: updated });
});
