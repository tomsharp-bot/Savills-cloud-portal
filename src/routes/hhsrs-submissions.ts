import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { formatDocDate } from "../lib/dates.js";
import { safeId, safeStoredName } from "../lib/hhsrs-site-form.js";
import {
  loadSiteFormPhoto,
  privateInlineHeaders,
  sitePhotoStorageFromApp,
} from "../lib/hhsrs-site-photos.js";

export const hhsrsSubmissionsRouter = Router();

hhsrsSubmissionsRouter.use(requireAdmin);

hhsrsSubmissionsRouter.get("/", async (req: Request, res: Response) => {
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.render("hhsrs-submissions", {
    title: "HHSRS site reports",
    user: req.user,
    rows,
    formatDocDate,
  });
});

hhsrsSubmissionsRouter.get("/:id", async (req: Request, res: Response) => {
  const row = await prisma.hhsrsSiteSubmission.findUnique({ where: { id: req.params.id } });
  if (!row) {
    res.status(404).send("Submission not found.");
    return;
  }
  const photos = Array.isArray(row.photoPaths) ? row.photoPaths.map(String) : [];
  res.render("hhsrs-submission", {
    title: "HHSRS site report",
    user: req.user,
    row,
    photos,
    formatDocDate,
  });
});

hhsrsSubmissionsRouter.get("/:id/photos/:name", async (req: Request, res: Response) => {
  const row = await prisma.hhsrsSiteSubmission.findUnique({
    where: { id: req.params.id },
    select: { id: true, photoPaths: true },
  });
  if (!row) {
    res.status(404).send("Photo not found.");
    return;
  }
  const photos = Array.isArray(row.photoPaths) ? row.photoPaths.map(String) : [];
  let storedName: string;
  try {
    storedName = safeStoredName(req.params.name);
    safeId(row.id);
  } catch {
    res.status(404).send("Photo not found.");
    return;
  }
  const expected = `hhsrs-site-form/${row.id}/${storedName}`;
  if (!photos.includes(expected)) {
    res.status(404).send("Photo not found.");
    return;
  }
  const loaded = await loadSiteFormPhoto(expected, sitePhotoStorageFromApp(req.app));
  if (!loaded) {
    res.status(404).send("Photo not found.");
    return;
  }
  const headers = privateInlineHeaders(loaded.fileName, loaded.body.length, loaded.contentType);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.status(200).send(loaded.body);
});
