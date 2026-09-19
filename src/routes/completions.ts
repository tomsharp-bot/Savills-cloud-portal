import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { canSeeProject } from "../lib/access.js";
import { userAccessIds } from "../middleware/auth.js";

export const completionsRouter = Router();

completionsRouter.get("/projects/:id/completions/:compId/:action", async (req, res) => {
  const user = req.user!;
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
