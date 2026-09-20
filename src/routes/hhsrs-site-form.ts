import path from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { HHSRS_CATEGORIES, HHSRS_RATINGS } from "../lib/hhsrs-categories.js";
import {
  deleteDraft,
  draftPhotoPath,
  emptyHhsrsValues,
  HHSRS_MAX_FILE_BYTES,
  HHSRS_MAX_PHOTOS,
  HHSRS_SITE_FORM_PATH,
  hhsrsUrl,
  keepRequestedPhotos,
  listKeepPhotoNames,
  newDraftId,
  persistSubmissionPhotos,
  pruneRemovedPhotos,
  readDraft,
  readHhsrsValues,
  saveIncomingPhotos,
  sweepOldDrafts,
  type HhsrsDraft,
  type HhsrsFieldErrors,
  type HhsrsFormValues,
  validateHhsrsForm,
  validatePhotos,
  writeDraft,
} from "../lib/hhsrs-site-form.js";

export const hhsrsSiteFormRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HHSRS_MAX_FILE_BYTES, files: HHSRS_MAX_PHOTOS },
});

const assetsDir = path.join(process.cwd(), "public", "hhsrs-site-form");

type Uploaded = Express.Multer.File;

function uploadPhotos(req: Request, res: Response, next: NextFunction): void {
  upload.array("photos", HHSRS_MAX_PHOTOS)(req, res, (err: unknown) => {
    if (err) {
      const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
      (req as Request & { hhsrsUploadError?: string }).hhsrsUploadError =
        code === "LIMIT_FILE_SIZE"
          ? "Each photo must be 8MB or smaller."
          : code === "LIMIT_UNEXPECTED_FILE" || code === "LIMIT_FILE_COUNT"
            ? `You can attach up to ${HHSRS_MAX_PHOTOS} photos.`
            : "Could not upload photos.";
    }
    next();
  });
}

async function loadActiveProjects(): Promise<{ id: string; name: string }[]> {
  try {
    return await prisma.project.findMany({
      where: { stage: "current" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  } catch {
    return [];
  }
}

async function findActiveProject(projectId: string): Promise<{ id: string; name: string } | null> {
  if (!projectId) return null;
  try {
    return await prisma.project.findFirst({
      where: { id: projectId, stage: "current" },
      select: { id: true, name: true },
    });
  } catch {
    return null;
  }
}

function filesOf(req: Request): Uploaded[] {
  return Array.isArray(req.files) ? (req.files as Uploaded[]) : [];
}

function uploadErrorOf(req: Request): string | undefined {
  return (req as Request & { hhsrsUploadError?: string }).hhsrsUploadError;
}

function renderForm(
  res: Response,
  opts: {
    values: HhsrsFormValues;
    errors?: HhsrsFieldErrors;
    draft?: HhsrsDraft | null;
    projects: { id: string; name: string }[];
    formError?: string;
  }
): void {
  res.render("hhsrs-site-form/form", {
    title: "New issue — Savills HHSRS Site Reporting",
    categories: HHSRS_CATEGORIES,
    ratings: HHSRS_RATINGS,
    values: opts.values,
    errors: opts.errors || {},
    draft: opts.draft || null,
    projects: opts.projects,
    formError: opts.formError || "",
    maxPhotos: HHSRS_MAX_PHOTOS,
  });
}

hhsrsSiteFormRouter.use((req: Request, res: Response, next: NextFunction) => {
  res.locals.hhsrsBase = HHSRS_SITE_FORM_PATH;
  res.locals.hhsrsUrl = hhsrsUrl;
  next();
});

hhsrsSiteFormRouter.use("/assets", express.static(assetsDir));

hhsrsSiteFormRouter.get("/", async (_req: Request, res: Response) => {
  await sweepOldDrafts();
  res.render("hhsrs-site-form/landing", {
    title: "Savills HHSRS Site Reporting",
  });
});

hhsrsSiteFormRouter.get("/new", async (req: Request, res: Response) => {
  const projects = await loadActiveProjects();
  const draftId = String(req.query.draft || "").trim();
  const draft = draftId ? await readDraft(draftId) : null;
  if (draft) {
    renderForm(res, { values: draft, draft, projects });
    return;
  }
  renderForm(res, { values: emptyHhsrsValues(), projects });
});

hhsrsSiteFormRouter.get("/draft/:draftId/photo/:name", async (req: Request, res: Response) => {
  try {
    const draft = await readDraft(req.params.draftId);
    if (!draft || !draft.photos.some((p) => p.storedName === req.params.name)) {
      res.status(404).send("Photo not found.");
      return;
    }
    res.sendFile(draftPhotoPath(draft.id, req.params.name), (err?: Error) => {
      if (err && !res.headersSent) res.status(404).send("Photo not found.");
    });
  } catch {
    res.status(404).send("Photo not found.");
  }
});

hhsrsSiteFormRouter.post("/review", uploadPhotos, async (req: Request, res: Response) => {
  const values = readHhsrsValues(req.body || {});
  const projects = await loadActiveProjects();
  const draftId = String(req.body?.draftId || "").trim() || newDraftId();
  const existing = await readDraft(draftId);
  const keep = existing ? keepRequestedPhotos(existing, listKeepPhotoNames(req.body || {})) : [];
  const incoming = filesOf(req);
  const photoError = uploadErrorOf(req) || validatePhotos(incoming, keep.length);
  const active = await findActiveProject(values.projectId);
  const checked = validateHhsrsForm(values, active);
  if (!checked.ok || photoError) {
    if (existing) await pruneRemovedPhotos(existing, keep);
    const draft: HhsrsDraft = {
      id: draftId,
      ...(checked.ok ? checked.data : { ...values, projectName: active?.name || "" }),
      photos: keep,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    await writeDraft(draft);
    renderForm(res, {
      values,
      errors: checked.ok ? (photoError ? { photos: photoError } : {}) : { ...checked.errors, ...(photoError ? { photos: photoError } : {}) },
      draft,
      projects,
      formError: photoError && checked.ok ? photoError : "",
    });
    return;
  }

  if (existing) await pruneRemovedPhotos(existing, keep);
  const added = incoming.length ? await saveIncomingPhotos(draftId, incoming) : [];
  const draft: HhsrsDraft = {
    id: draftId,
    ...checked.data,
    photos: [...keep, ...added],
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  await writeDraft(draft);
  res.render("hhsrs-site-form/review", {
    title: "Review issue — Savills HHSRS Site Reporting",
    draft,
  });
});

hhsrsSiteFormRouter.post("/edit", async (req: Request, res: Response) => {
  const draftId = String(req.body?.draftId || "").trim();
  const draft = draftId ? await readDraft(draftId) : null;
  if (!draft) {
    res.redirect(hhsrsUrl("/new"));
    return;
  }
  const projects = await loadActiveProjects();
  renderForm(res, { values: draft, draft, projects });
});

hhsrsSiteFormRouter.post("/cancel", async (req: Request, res: Response) => {
  const draftId = String(req.body?.draftId || "").trim();
  if (draftId) await deleteDraft(draftId);
  res.redirect(hhsrsUrl("/"));
});

hhsrsSiteFormRouter.post("/submit", async (req: Request, res: Response) => {
  const draftId = String(req.body?.draftId || "").trim();
  const draft = draftId ? await readDraft(draftId) : null;
  if (!draft) {
    res.redirect(hhsrsUrl("/new"));
    return;
  }
  const active = await findActiveProject(draft.projectId);
  const checked = validateHhsrsForm(draft, active);
  if (!checked.ok) {
    const projects = await loadActiveProjects();
    renderForm(res, { values: draft, errors: checked.errors, draft, projects });
    return;
  }
  const created = await prisma.hhsrsSiteSubmission.create({
    data: {
      projectId: checked.data.projectId,
      projectName: checked.data.projectName,
      surveyDate: checked.data.surveyDate,
      uprn: checked.data.uprn,
      fullAddress: checked.data.fullAddress,
      postcode: checked.data.postcode,
      surveyorName: checked.data.surveyorName,
      category: checked.data.category,
      rating: checked.data.rating,
      comment: checked.data.comment,
      clientCallReference: checked.data.clientCallReference,
      otherDetails: checked.data.otherDetails,
      photoPaths: [],
    },
  });
  const photoPaths = await persistSubmissionPhotos(created.id, draft);
  if (photoPaths.length) {
    await prisma.hhsrsSiteSubmission.update({
      where: { id: created.id },
      data: { photoPaths },
    });
  }
  await deleteDraft(draft.id);
  res.redirect(hhsrsUrl(`/thanks?id=${encodeURIComponent(created.id)}`));
});

hhsrsSiteFormRouter.get("/thanks", (req: Request, res: Response) => {
  res.render("hhsrs-site-form/thanks", {
    title: "Issue submitted — Savills HHSRS Site Reporting",
    submissionId: String(req.query.id || ""),
  });
});
