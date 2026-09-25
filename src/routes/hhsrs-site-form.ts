import fs from "node:fs/promises";
import path from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { allowAddressLookup } from "../lib/ideal-postcodes.js";
import { prisma } from "../lib/prisma.js";
import { isProduction } from "../config.js";
import { HHSRS_CATEGORIES, HHSRS_SITE_FORM_RATINGS } from "../lib/hhsrs-categories.js";
import {
  CALL_REF_BLANK_REASONS,
  deleteDraft,
  draftPhotoPath,
  emptyHhsrsValues,
  submissionDir,
  HHSRS_MAX_FILE_BYTES,
  HHSRS_MAX_FILE_MB,
  HHSRS_MAX_PHOTOS,
  HHSRS_MIN_PHOTOS,
  HHSRS_SITE_FORM_PATH,
  hhsrsMulterLimits,
  hhsrsPhotoHint,
  hhsrsPhotoSizeError,
  hhsrsUrl,
  keepRequestedPhotos,
  listKeepPhotoNames,
  newDraftId,
  normalizeUprn,
  persistSubmissionPhotos,
  pruneRemovedPhotos,
  readDraft,
  readHhsrsValues,
  saveIncomingPhotos,
  siteFormSectionState,
  stockMatchFromRows,
  sweepOldDrafts,
  type HhsrsDraft,
  type HhsrsFieldErrors,
  type HhsrsFormValues,
  type StockAddressMatch,
  type StockLookupRow,
  validateHhsrsForm,
  siteFormProjectFlags,
  siteSubmissionCallFields,
  validatePhotos,
  writeDraft,
} from "../lib/hhsrs-site-form.js";
import {
  PHOTOS_NOT_STORED,
  SitePhotoError,
  sitePhotoStorageFromApp,
} from "../lib/hhsrs-site-photos.js";

export const hhsrsSiteFormRouter = Router();

/** Review "Edit" may scroll the form back to one of these sections. Anything else is ignored. */
const EDIT_JUMPS = new Set(["step-visit", "step-property", "step-hazard", "extra-box", "step-photos"]);

function reviewEditJump(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const jump = String(raw ?? "").trim();
  return EDIT_JUMPS.has(jump) ? jump : "";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: hhsrsMulterLimits,
});

const assetsDir = path.join(process.cwd(), "public", "hhsrs-site-form");

type Uploaded = Express.Multer.File;

function uploadPhotos(req: Request, res: Response, next: NextFunction): void {
  upload.array("photos", HHSRS_MAX_PHOTOS)(req, res, (err: unknown) => {
    if (err) {
      const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
      (req as Request & { hhsrsUploadError?: string }).hhsrsUploadError =
        code === "LIMIT_FILE_SIZE"
          ? hhsrsPhotoSizeError()
          : code === "LIMIT_UNEXPECTED_FILE" || code === "LIMIT_FILE_COUNT"
            ? `Add ${HHSRS_MIN_PHOTOS} to ${HHSRS_MAX_PHOTOS} photos.`
            : "Could not upload photos.";
    }
    next();
  });
}

const DEV_DEMO_PROJECT = { id: "hhsrs-demo-current", name: "Demo current project (local)" };
const DEV_DEMO_SURVEYOR = { id: "hhsrs-demo-surveyor", name: "Alex Surveyor" };

type SurveyorOption = { id: string; name: string };

function withDevDemo(projects: { id: string; name: string }[]): { id: string; name: string }[] {
  if (isProduction || projects.length) return projects;
  return [DEV_DEMO_PROJECT];
}

async function loadActiveProjects(): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await prisma.project.findMany({
      where: { stage: "current" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return withDevDemo(rows);
  } catch {
    return withDevDemo([]);
  }
}

async function findActiveProject(projectId: string): Promise<{ id: string; name: string } | null> {
  if (!projectId) return null;
  if (!isProduction && projectId === DEV_DEMO_PROJECT.id) return DEV_DEMO_PROJECT;
  try {
    return await prisma.project.findFirst({
      where: { id: projectId, stage: "current" },
      select: { id: true, name: true },
    });
  } catch {
    return !isProduction && projectId === DEV_DEMO_PROJECT.id ? DEV_DEMO_PROJECT : null;
  }
}

function withDevSurveyors(rows: SurveyorOption[]): SurveyorOption[] {
  if (isProduction || rows.length) return rows;
  return [DEV_DEMO_SURVEYOR];
}

async function loadSurveyors(): Promise<SurveyorOption[]> {
  try {
    const rows = await prisma.user.findMany({
      where: { role: "surveyor", frozen: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const named = rows
      .map((row) => ({ id: row.id, name: String(row.name || "").trim() }))
      .filter((row) => row.name);
    return withDevSurveyors(named);
  } catch {
    return withDevSurveyors([]);
  }
}

function isDemoProject(projectId: string): boolean {
  return !isProduction && projectId === DEV_DEMO_PROJECT.id;
}

async function findStockMatch(projectId: string, uprnRaw: string): Promise<StockAddressMatch | null> {
  const uprn = normalizeUprn(uprnRaw);
  if (!uprn || uprn.length > 64 || isDemoProject(projectId)) return null;
  const rows = await prisma.asset.findMany({
    where: {
      projectId,
      omitAsset: false,
      stockMissing: false,
      uprn: { equals: uprn, mode: "insensitive" },
    },
    select: {
      uprn: true,
      kind: true,
      number: true,
      block: true,
      street: true,
      area: true,
      city: true,
      postcode: true,
    },
    take: 8,
  });
  return stockMatchFromRows(rows as StockLookupRow[]);
}

async function stockUprnError(projectId: string, uprn: string): Promise<string | undefined> {
  if (!uprn || isDemoProject(projectId)) return undefined;
  try {
    const match = await findStockMatch(projectId, uprn);
    if (!match) return "No match on this project's stock list — check the UPRN.";
    return undefined;
  } catch {
    return "Could not check this UPRN on the project stock list. Try again.";
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
    surveyors: SurveyorOption[];
    formError?: string;
    jump?: string;
  }
): void {
  const projects = opts.projects.map((project) => ({
    ...project,
    flags: siteFormProjectFlags(project.name),
  }));
  const selected = projects.find((project) => project.id === opts.values.projectId);
  res.render("hhsrs-site-form/form", {
    title: "New issue — Savills HHSRS Site Reporting",
    categories: HHSRS_CATEGORIES,
    ratings: HHSRS_SITE_FORM_RATINGS,
    callBlankReasons: CALL_REF_BLANK_REASONS,
    values: opts.values,
    errors: opts.errors || {},
    draft: opts.draft || null,
    projects,
    surveyors: opts.surveyors,
    steps: siteFormSectionState(opts.values, selected?.name || ""),
    formError: opts.formError || "",
    maxPhotos: HHSRS_MAX_PHOTOS,
    minPhotos: HHSRS_MIN_PHOTOS,
    maxFileMb: HHSRS_MAX_FILE_MB,
    maxFileBytes: HHSRS_MAX_FILE_BYTES,
    photoHint: hhsrsPhotoHint(),
    jump: reviewEditJump(opts.jump),
  });
}

hhsrsSiteFormRouter.use((req: Request, res: Response, next: NextFunction) => {
  res.locals.hhsrsBase = HHSRS_SITE_FORM_PATH;
  res.locals.hhsrsUrl = hhsrsUrl;
  next();
});

hhsrsSiteFormRouter.use("/assets", express.static(assetsDir));

function queryValue(value: unknown): string {
  return (Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "")).trim();
}

function surveyorNamesFor(projectId: string, surveyors: SurveyorOption[]): string[] | undefined {
  if (isDemoProject(projectId)) return undefined;
  return surveyors.map((row) => row.name);
}

async function checkSubmission(
  values: HhsrsFormValues,
  surveyors: SurveyorOption[]
): Promise<{
  active: { id: string; name: string } | null;
  checked: ReturnType<typeof validateHhsrsForm>;
}> {
  const active = await findActiveProject(values.projectId);
  const checked = validateHhsrsForm(values, active, {
    surveyorNames: surveyorNamesFor(values.projectId, surveyors),
  });
  if (!values.uprn || !active) return { active, checked };
  const stockErr = await stockUprnError(active.id, values.uprn);
  if (!stockErr) return { active, checked };
  return {
    active,
    checked: {
      ok: false,
      errors: checked.ok ? { uprn: stockErr } : { ...checked.errors, uprn: stockErr },
    },
  };
}

async function stockLookup(req: Request, res: Response): Promise<void> {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!allowAddressLookup(ip)) {
    res.status(429).json({ error: "Too many lookups. Wait a moment and try again." });
    return;
  }
  const projectId = queryValue(req.query.projectId);
  const uprn = normalizeUprn(queryValue(req.query.uprn));
  if (!projectId) {
    res.status(400).json({ error: "Choose a project first." });
    return;
  }
  if (!uprn) {
    res.status(400).json({ error: "Enter a UPRN." });
    return;
  }
  const active = await findActiveProject(projectId);
  if (!active) {
    res.status(400).json({ error: "Choose a project first." });
    return;
  }
  try {
    const match = await findStockMatch(active.id, uprn);
    if (!match) {
      res.status(404).json({ error: "No match on this project's stock list — check the UPRN." });
      return;
    }
    res.json({ match });
  } catch {
    res.status(503).json({ error: "Could not look up that UPRN. Try again." });
  }
}

hhsrsSiteFormRouter.get("/stock-lookup", stockLookup);

hhsrsSiteFormRouter.get("/", async (_req: Request, res: Response) => {
  await sweepOldDrafts();
  res.render("hhsrs-site-form/landing", {
    title: "Savills HHSRS Site Reporting",
  });
});

hhsrsSiteFormRouter.get("/new", async (req: Request, res: Response) => {
  const [projects, surveyors] = await Promise.all([loadActiveProjects(), loadSurveyors()]);
  const draftId = String(req.query.draft || "").trim();
  const draft = draftId ? await readDraft(draftId) : null;
  if (draft) {
    renderForm(res, { values: draft, draft, projects, surveyors });
    return;
  }
  renderForm(res, { values: emptyHhsrsValues(), projects, surveyors });
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
  const [projects, surveyors] = await Promise.all([loadActiveProjects(), loadSurveyors()]);
  const draftId = String(req.body?.draftId || "").trim() || newDraftId();
  const existing = await readDraft(draftId);
  const keep = existing ? keepRequestedPhotos(existing, listKeepPhotoNames(req.body || {})) : [];
  const incoming = filesOf(req);
  const photoError = uploadErrorOf(req) || validatePhotos(incoming, keep.length);
  const { active, checked } = await checkSubmission(values, surveyors);
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
      surveyors,
      formError: photoError && checked.ok ? photoError : "",
    });
    return;
  }

  if (existing) await pruneRemovedPhotos(existing, keep);
  let added: Awaited<ReturnType<typeof saveIncomingPhotos>> = [];
  try {
    added = incoming.length ? await saveIncomingPhotos(draftId, incoming) : [];
  } catch (err) {
    const message = err instanceof SitePhotoError ? err.message : "Could not save that photo. Try again.";
    const draft: HhsrsDraft = {
      id: draftId,
      ...checked.data,
      photos: keep,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    await writeDraft(draft);
    renderForm(res, {
      values,
      errors: { photos: message },
      draft,
      projects,
      surveyors,
      formError: message,
    });
    return;
  }
  const draft: HhsrsDraft = {
    id: draftId,
    ...checked.data,
    photos: [...keep, ...added],
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  await writeDraft(draft);
  res.redirect(hhsrsUrl(`/review?draft=${encodeURIComponent(draft.id)}`));
});

hhsrsSiteFormRouter.get("/review", async (req: Request, res: Response) => {
  const draft = await readDraft(String(req.query.draft || "").trim());
  if (!draft) {
    res.redirect(hhsrsUrl("/new"));
    return;
  }
  res.render("hhsrs-site-form/review", {
    title: "Review issue — Savills HHSRS Site Reporting",
    draft,
    storeError: "",
  });
});

hhsrsSiteFormRouter.post("/edit", async (req: Request, res: Response) => {
  const draftId = String(req.body?.draftId || "").trim();
  const draft = draftId ? await readDraft(draftId) : null;
  if (!draft) {
    res.redirect(hhsrsUrl("/new"));
    return;
  }
  const [projects, surveyors] = await Promise.all([loadActiveProjects(), loadSurveyors()]);
  renderForm(res, { values: draft, draft, projects, surveyors, jump: reviewEditJump(req.body?.jump) });
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
  const surveyors = await loadSurveyors();
  const { checked } = await checkSubmission(draft, surveyors);
  const photoError = validatePhotos([], draft.photos.length);
  if (!checked.ok || photoError) {
    const projects = await loadActiveProjects();
    renderForm(res, {
      values: draft,
      errors: {
        ...(checked.ok ? {} : checked.errors),
        ...(photoError ? { photos: photoError } : {}),
      },
      draft,
      projects,
      surveyors,
      formError: photoError && checked.ok ? photoError : "",
    });
    return;
  }
  const call = siteSubmissionCallFields(checked.data);
  const storage = sitePhotoStorageFromApp(req.app);
  let createdId = "";
  let storedKeys: string[] = [];
  try {
    const created = await prisma.hhsrsSiteSubmission.create({
      data: {
        projectId: isDemoProject(checked.data.projectId) ? null : checked.data.projectId,
        projectName: checked.data.projectName,
        surveyDate: checked.data.surveyDate,
        uprn: checked.data.uprn,
        fullAddress: checked.data.fullAddress,
        postcode: checked.data.postcode,
        surveyorName: checked.data.surveyorName,
        category: checked.data.category,
        rating: checked.data.rating,
        comment: checked.data.comment,
        clientCallReference: call.clientCallReference,
        callOutcome: call.callOutcome,
        callNotes: call.callNotes,
        otherDetails: checked.data.otherDetails,
        cat1Confirmed: checked.data.cat1Confirmed,
        photoPaths: [],
      },
    });
    createdId = created.id;
    storedKeys = await persistSubmissionPhotos(created.id, draft, storage);
    if (storedKeys.length !== draft.photos.length) {
      throw new SitePhotoError(PHOTOS_NOT_STORED);
    }
    if (storedKeys.length) {
      await prisma.hhsrsSiteSubmission.update({
        where: { id: created.id },
        data: { photoPaths: storedKeys },
      });
    }
    await deleteDraft(draft.id);
    res.redirect(hhsrsUrl(`/thanks?id=${encodeURIComponent(created.id)}`));
  } catch (err) {
    if (storedKeys.length) {
      await Promise.all(storedKeys.map((key) => storage.remove(key).catch(() => false)));
    }
    if (createdId) {
      await prisma.hhsrsSiteSubmission.delete({ where: { id: createdId } }).catch(() => undefined);
      await fs.rm(submissionDir(createdId), { recursive: true, force: true }).catch(() => undefined);
    }
    const message = err instanceof SitePhotoError ? err.message : PHOTOS_NOT_STORED;
    if (!(err instanceof SitePhotoError)) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`HHSRS site-form submit failed: ${detail}`);
    }
    res.status(200).render("hhsrs-site-form/review", {
      title: "Review issue — Savills HHSRS Site Reporting",
      draft,
      storeError: message,
    });
  }
});

hhsrsSiteFormRouter.get("/thanks", (req: Request, res: Response) => {
  res.render("hhsrs-site-form/thanks", {
    title: "Issue submitted — Savills HHSRS Site Reporting",
    submissionId: String(req.query.id || ""),
  });
});
