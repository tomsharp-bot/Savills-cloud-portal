import path from "node:path";
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { formatDocDate } from "../lib/dates.js";
import { config } from "../config.js";
import { HHSRS_CATEGORIES, HHSRS_RATINGS, isHhsrsRating } from "../lib/hhsrs-categories.js";
import { safeId, safeStoredName } from "../lib/hhsrs-site-form.js";
import { ONWARD_TOPICS } from "../lib/hhsrs-reporter-draft.js";
import {
  HHSRS_CALL_OUTCOMES,
  HHSRS_CASE_STATUSES,
  HHSRS_REPORTER_PATH,
  isHhsrsCaseStatus,
  photoNames,
  readReporterUpdate,
  statusLabel,
  tryDraftFromRow,
} from "../lib/hhsrs-reporter.js";

export const hhsrsReporterRouter = Router();

hhsrsReporterRouter.use(requireAdmin);

hhsrsReporterRouter.use((req: Request, res: Response, next) => {
  res.locals.reporterBase = HHSRS_REPORTER_PATH;
  res.locals.statusLabel = statusLabel;
  next();
});

function flashOk(req: Request, message: string): void {
  req.session = req.session || {};
  req.session.flashOk = message;
}

function takeFlash(req: Request): { ok: string; err: string } {
  const ok = req.session?.flashOk || "";
  const err = req.session?.flashErr || "";
  if (req.session) {
    delete req.session.flashOk;
    delete req.session.flashErr;
  }
  return { ok, err };
}

hhsrsReporterRouter.get("/", async (req: Request, res: Response) => {
  const statusFilter = String(req.query.status || "").trim();
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    where: statusFilter && isHhsrsCaseStatus(statusFilter) ? { status: statusFilter } : undefined,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const flash = takeFlash(req);
  res.render("hhsrs-reporter/list", {
    title: "HHSRS Reporter",
    user: req.user,
    rows,
    statusFilter,
    statuses: HHSRS_CASE_STATUSES,
    formatDocDate,
    flashOk: flash.ok,
    flashErr: flash.err,
  });
});

async function loadCase(id: string) {
  return prisma.hhsrsSiteSubmission.findUnique({ where: { id } });
}

function renderCase(
  req: Request,
  res: Response,
  row: NonNullable<Awaited<ReturnType<typeof loadCase>>>,
  opts: { flashOk?: string; flashErr?: string; draftError?: string } = {}
): void {
  const photos = photoNames(row);
  const draft = tryDraftFromRow(row);
  const flash = takeFlash(req);
  res.render("hhsrs-reporter/case", {
    title: "HHSRS case — " + row.projectName,
    user: req.user,
    row,
    photos,
    draftSubject: draft.subject || row.emailSubject,
    draftBody: draft.body || row.emailBody,
    draftError: opts.draftError || draft.error,
    categories: HHSRS_CATEGORIES,
    ratings: HHSRS_RATINGS,
    statuses: HHSRS_CASE_STATUSES,
    callOutcomes: HHSRS_CALL_OUTCOMES,
    onwardTopics: ONWARD_TOPICS,
    formatDocDate,
    flashOk: opts.flashOk || flash.ok,
    flashErr: opts.flashErr || flash.err,
  });
}

hhsrsReporterRouter.get("/:id", async (req: Request, res: Response) => {
  const row = await loadCase(req.params.id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  renderCase(req, res, row);
});

hhsrsReporterRouter.post("/:id", async (req: Request, res: Response) => {
  const row = await loadCase(req.params.id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const update = readReporterUpdate(req.body || {});
  if (!isHhsrsRating(update.rating)) {
    renderCase(req, res, row, { flashErr: "Select Low, Medium or High for the rating." });
    return;
  }
  if (!isHhsrsCaseStatus(update.status)) {
    renderCase(req, res, row, { flashErr: "Select a valid case status." });
    return;
  }
  if (
    update.callOutcome &&
    !(HHSRS_CALL_OUTCOMES as readonly string[]).includes(update.callOutcome)
  ) {
    renderCase(req, res, row, { flashErr: "Select a valid call outcome." });
    return;
  }

  const expected = update.expectedUpdatedAt ? new Date(update.expectedUpdatedAt) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    renderCase(req, res, row, { flashErr: "Missing concurrency token. Reload the case and try again." });
    return;
  }
  if (row.updatedAt.getTime() !== expected.getTime()) {
    renderCase(req, res, row, {
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then save again.",
    });
    return;
  }

  const editor = req.user?.name || req.user?.username || "";
  const data = {
    rating: update.rating,
    clientDescription: update.clientDescription,
    clientCallReference: update.clientCallReference,
    callOutcome: update.callOutcome,
    workOrder: update.workOrder,
    suspectedCause: update.suspectedCause,
    includeCause: update.includeCause,
    vulnerabilities: update.vulnerabilities,
    escalation: update.escalation,
    onwardTopic: update.onwardTopic,
    cat1Confirmed: update.cat1Confirmed,
    internalNotes: update.internalNotes,
    status: update.status,
    lastEditedBy: editor,
  };

  const preview = tryDraftFromRow({ ...row, ...data });
  const withDraft = {
    ...data,
    emailSubject: preview.subject || row.emailSubject,
    emailBody: preview.body || row.emailBody,
  };

  const result = await prisma.hhsrsSiteSubmission.updateMany({
    where: { id: row.id, updatedAt: expected },
    data: withDraft,
  });
  if (result.count !== 1) {
    const fresh = await loadCase(row.id);
    if (!fresh) {
      res.status(404).send("Case not found.");
      return;
    }
    renderCase(req, res, fresh, {
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then save again.",
    });
    return;
  }

  flashOk(req, "Case saved.");
  res.redirect(`${HHSRS_REPORTER_PATH}/${row.id}`);
});

hhsrsReporterRouter.post("/:id/mark-sent", async (req: Request, res: Response) => {
  const row = await loadCase(req.params.id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const expectedRaw = String(req.body?.expectedUpdatedAt || "").trim();
  const expected = expectedRaw ? new Date(expectedRaw) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    renderCase(req, res, row, { flashErr: "Missing concurrency token. Reload the case and try again." });
    return;
  }
  if (row.updatedAt.getTime() !== expected.getTime()) {
    renderCase(req, res, row, {
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then mark sent again.",
    });
    return;
  }

  const draft = tryDraftFromRow(row);
  const editor = req.user?.name || req.user?.username || "";
  const result = await prisma.hhsrsSiteSubmission.updateMany({
    where: { id: row.id, updatedAt: expected },
    data: {
      status: "email_sent",
      emailSentAt: new Date(),
      emailSentBy: editor,
      lastEditedBy: editor,
      emailSubject: draft.subject || row.emailSubject,
      emailBody: draft.body || row.emailBody,
    },
  });
  if (result.count !== 1) {
    const fresh = await loadCase(row.id);
    if (!fresh) {
      res.status(404).send("Case not found.");
      return;
    }
    renderCase(req, res, fresh, {
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then mark sent again.",
    });
    return;
  }
  flashOk(req, "Marked as email sent. Attach photos in Outlook before you send.");
  res.redirect(`${HHSRS_REPORTER_PATH}/${row.id}`);
});

hhsrsReporterRouter.get("/:id/photos/:name", async (req: Request, res: Response) => {
  const row = await prisma.hhsrsSiteSubmission.findUnique({
    where: { id: req.params.id },
    select: { id: true, photoPaths: true },
  });
  if (!row) {
    res.status(404).send("Photo not found.");
    return;
  }
  const photos = photoNames(row);
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
  const dest = path.resolve(process.cwd(), config.uploadDir, expected);
  res.sendFile(dest, (err?: Error) => {
    if (err && !res.headersSent) {
      res.status(404).send("File missing on disk. TODO: fetch from Spaces cloud-portal-vault.");
    }
  });
});
