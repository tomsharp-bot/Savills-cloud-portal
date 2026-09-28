import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { formatDocDate } from "../lib/dates.js";
import {
  HHSRS_CATEGORIES,
  HHSRS_RATINGS,
  HHSRS_SITE_FORM_RATINGS,
  isHhsrsRating,
} from "../lib/hhsrs-categories.js";
import { safeId, safeStoredName } from "../lib/hhsrs-site-form.js";
import { copyLoggedHhsrsPhotos } from "../lib/hhsrs-completed-photos.js";
import { ONWARD_TOPICS } from "../lib/hhsrs-reporter-draft.js";
import {
  HHSRS_ACTIONED_STATUSES,
  HHSRS_CALL_OUTCOMES,
  HHSRS_CASE_STATUSES,
  statusForReviewSave,
  HHSRS_REPORTER_PATH,
  HHSRS_WAITING_STATUSES,
  actionedStatusLabel,
  formatTimeAgo,
  formatWorkspaceDate,
  isWaitingStatus,
  draftEmailFromReviewFields,
  mergeReviewDraftFields,
  photoAttachmentCount,
  photoNames,
  ratingDisplayClass,
  readReporterUpdate,
  reporterCasePhotos,
  statusLabel,
  tryDraftFromRow,
  type ReporterCasePhoto,
  type ReporterSummary,
} from "../lib/hhsrs-reporter.js";
import {
  PP_HHSRS_ALIAS,
  RATING_OPTIONS,
  REPORTER_DEMO_PROJECTS,
  SITE_FORM_PUBLIC_URL,
  matchDemoProject,
  progressNameForCase,
} from "../lib/hhsrs-reporter-projects.js";
import {
  PROJECT_PROGRESS_CHANGE_TOAST,
  buildProjectOverview,
  type LiveProjectCounts,
  type ProgressProject,
  type ProjectOverview,
} from "../lib/hhsrs-reporter-overview.js";
import { pendingAlertSummary } from "../lib/hhsrs-pending-alerts.js";
import { claimRowClass, claimView, claimerLabel, type ClaimView } from "../lib/hhsrs-claims.js";
import { isAdmin, type AuthedUser } from "../lib/access.js";
import {
  fromAddressFromEnv,
  publicSendSettings,
  senderNamesFromLogin,
  sentBannerText,
} from "../lib/hhsrs-send.js";
import { listSentEmails, originalSentEmail, photoByteSize, sendCaseEmail } from "../lib/hhsrs-send-case.js";
import {
  CORRECTION_REASONS,
  MISSING_EMAIL_BODY,
  correctionSubject,
  findCaseWhere,
  findStatusLabel,
  formatLondonDate,
  formatLondonDateTime,
  latestSentLog,
  mainLogCardRows,
  type SentLogEmail,
} from "../lib/hhsrs-find.js";
import {
  SITE_FORM_CODE_CHANGED,
  SITE_FORM_CODE_INVALID,
  SiteFormAccessError,
  accessChangedLine,
  changeSiteFormAccessCode,
  loadSiteFormAccess,
} from "../lib/hhsrs-site-access.js";
import {
  clientRecipientsForProject,
  loadClientEmailCards,
  saveClientEmail,
  sendBodyWithClientRecipients,
  unmatchedClientEmailError,
  type ClientEmailFlash,
} from "../lib/hhsrs-client-emails.js";
import {
  buildMainLogWorkbook,
  casePhotoViews,
  correctionLinkLine,
  filtersActive,
  loadMainLog,
  loadMainLogExport,
  mainLogTypeLabel,
  showingLabel,
  type MainLogFilters,
} from "../lib/hhsrs-main-log.js";
import {
  loadSiteFormPhoto,
  privateInlineHeaders,
  sitePhotoStorageFromApp,
  type SitePhotoStorage,
} from "../lib/hhsrs-site-photos.js";
import {
  MISSING_SENDER_NAME_WARNING,
  renderSignatureHtml,
  resolveSenderSignature,
  signatureFromLoggedSender,
  type SenderSignature,
} from "../lib/hhsrs-signature.js";

function signatureLogoUrl(res: Response): string {
  if (typeof res.locals.baseUrl === "function") {
    return res.locals.baseUrl("/img/savills-hhsrs-signature.png");
  }
  return "/img/savills-hhsrs-signature.png";
}

/** Login first name and surname. Personnel (surveyors) only if the login has neither. */
async function senderSignatureFor(user: AuthedUser | null | undefined): Promise<SenderSignature> {
  const firstName = user?.firstName;
  const surname = user?.surname;
  const email = String(user?.email || "").trim();
  const loginNamed = Boolean(String(firstName || "").trim() || String(surname || "").trim());
  const personnel: { name: string; email: string | null }[] = [];
  if (!loginNamed && email) {
    const hit = await prisma.user.findFirst({
      where: { role: "surveyor", email: { equals: email, mode: "insensitive" } },
      select: { name: true, email: true },
    });
    if (hit) personnel.push(hit);
  }
  return resolveSenderSignature({ firstName, surname, email, personnel });
}

function signatureLocals(res: Response, names: SenderSignature) {
  return {
    signatureHtml: renderSignatureHtml(names, signatureLogoUrl(res)),
    emailSignature: {
      missing: names.missing,
      warning: names.missing ? MISSING_SENDER_NAME_WARNING : "",
    },
  };
}

export const hhsrsReporterRouter = Router();

hhsrsReporterRouter.use(requireAdmin);

hhsrsReporterRouter.use((req: Request, res: Response, next) => {
  res.locals.reporterBase = HHSRS_REPORTER_PATH;
  res.locals.statusLabel = statusLabel;
  res.locals.actionedStatusLabel = actionedStatusLabel;
  res.locals.formatTimeAgo = formatTimeAgo;
  res.locals.formatDocDate = formatDocDate;
  res.locals.formatWorkspaceDate = formatWorkspaceDate;
  res.locals.ratingDisplayClass = ratingDisplayClass;
  res.locals.photoAttachmentCount = photoAttachmentCount;
  res.locals.reporterCasePhotos = reporterCasePhotos;
  res.locals.claimView = claimView;
  res.locals.claimRowClass = (row: { claimedBy?: string | null; claimedAt?: Date | string | null }) =>
    claimRowClass(claimView(row).status);
  res.locals.siteFormPublicUrl = SITE_FORM_PUBLIC_URL;
  res.locals.logoUrl = "/hhsrs-reporter/savills-logo.svg";
  // Logo is served from portal static; prefer baseUrl when available.
  if (typeof res.locals.baseUrl === "function") {
    res.locals.logoUrl = res.locals.baseUrl("/hhsrs-reporter/savills-logo.svg");
    res.locals.reporterCssUrl = res.locals.baseUrl("/css/hhsrs-reporter.css");
    res.locals.reporterJsUrl = res.locals.baseUrl("/js/hhsrs-reporter.js");
    res.locals.portalHomeUrl = res.locals.baseUrl("/admin");
    res.locals.logoutUrl = res.locals.baseUrl("/logout");
  } else {
    res.locals.reporterCssUrl = "/css/hhsrs-reporter.css";
    res.locals.reporterJsUrl = "/js/hhsrs-reporter.js";
    res.locals.portalHomeUrl = "/admin";
    res.locals.logoutUrl = "/logout";
  }
  next();
});

/** Waiting ids rendered with this page. The alert script does not treat them as already seen. */
hhsrsReporterRouter.use(async (req: Request, res: Response, next) => {
  res.locals.initialPendingIds = null;
  const skip =
    req.path.endsWith(".json") ||
    req.path.endsWith(".csv") ||
    req.path.endsWith(".xlsx") ||
    req.path.includes("/photos/");
  if (skip) {
    next();
    return;
  }
  try {
    const rows = await prisma.hhsrsSiteSubmission.findMany({
      where: { status: { in: [...HHSRS_WAITING_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true },
    });
    res.locals.initialPendingIds = rows.map((row) => row.id);
  } catch {
    res.locals.initialPendingIds = null;
  }
  next();
});

function flashOk(req: Request, message: string): void {
  req.session = req.session || {};
  req.session.flashOk = message;
}

function flashPo(req: Request, message: string): void {
  req.session = req.session || {};
  req.session.flashPo = message;
}

function takeFlash(req: Request): { ok: string; err: string; po: string } {
  const ok = req.session?.flashOk || "";
  const err = req.session?.flashErr || "";
  const po = req.session?.flashPo || "";
  if (req.session) {
    delete req.session.flashOk;
    delete req.session.flashErr;
    delete req.session.flashPo;
  }
  return { ok, err, po };
}

async function loadSummary(): Promise<ReporterSummary> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [waiting, inReview, actionedMonth, mainLog] = await Promise.all([
    prisma.hhsrsSiteSubmission.count({ where: { status: { in: [...HHSRS_WAITING_STATUSES] } } }),
    prisma.hhsrsSiteSubmission.count({ where: { status: "in_review" } }),
    prisma.hhsrsSiteSubmission.count({
      where: {
        status: { in: [...HHSRS_ACTIONED_STATUSES] },
        OR: [
          { emailSentAt: { gte: monthStart } },
          { emailSentAt: null, updatedAt: { gte: monthStart } },
        ],
      },
    }),
    prisma.hhsrsSiteSubmission.count({ where: { status: { in: [...HHSRS_ACTIONED_STATUSES] } } }),
  ]);
  return { waiting, inReview, actionedMonth, mainLog };
}

async function loadCase(id: string) {
  return prisma.hhsrsSiteSubmission.findUnique({ where: { id } });
}

async function loadProgressProjects(): Promise<ProgressProject[]> {
  return prisma.project.findMany({
    select: { name: true, stage: true },
    orderBy: { name: "asc" },
  });
}

async function loadWaitingIds(): Promise<string[]> {
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    where: { status: { in: [...HHSRS_WAITING_STATUSES] } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => row.id);
}

function reviewProjectNames(progress: ProgressProject[], selected: string): string[] {
  const names = progress.filter((project) => project.stage === "current").map((project) => project.name);
  if (selected && !names.some((name) => name === selected)) names.push(selected);
  return names;
}

/** Claim an open waiting case. Claimed and stale rows are left with their current owner. */
async function claimIfOpen(
  row: NonNullable<Awaited<ReturnType<typeof loadCase>>>,
  claimer: string
): Promise<NonNullable<Awaited<ReturnType<typeof loadCase>>>> {
  if (!isWaitingStatus(row.status)) return row;
  if (claimView(row).status !== "open") return row;
  const claimedAt = new Date();
  const result = await prisma.hhsrsSiteSubmission.updateMany({
    where: { id: row.id, claimedBy: "" },
    data: { claimedBy: claimer, claimedAt },
  });
  if (result.count !== 1) {
    return (await loadCase(row.id)) || row;
  }
  return { ...row, claimedBy: claimer, claimedAt };
}

function shellLocals(opts: {
  activeNav: "pending" | "review" | "find" | "main-log" | "admin" | "project-overview";
  summary: ReporterSummary;
  title?: string;
  flashOk?: string;
  flashErr?: string;
}) {
  return {
    title: opts.title || "HHSRS Reporter",
    activeNav: opts.activeNav,
    summary: opts.summary,
    workspaceDate: formatWorkspaceDate(),
    flashOk: opts.flashOk || "",
    flashErr: opts.flashErr || "",
  };
}

/* ---------- Lightweight poll for new pending hazards ---------- */
hhsrsReporterRouter.get("/pending-alerts.json", async (_req: Request, res: Response) => {
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    where: { status: { in: [...HHSRS_WAITING_STATUSES] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      projectName: true,
      fullAddress: true,
      category: true,
      rating: true,
      comment: true,
      createdAt: true,
      claimedBy: true,
      claimedAt: true,
    },
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    pending: rows.map((row) => {
      const claim = claimView(row);
      return {
        id: row.id,
        projectName: row.projectName,
        fullAddress: row.fullAddress,
        category: row.category,
        rating: row.rating,
        summary: pendingAlertSummary(row),
        createdAt: row.createdAt.toISOString(),
        claimStatus: claim.status,
        claimedBy: claim.claimedBy,
      };
    }),
  });
});

/* ---------- Pending Issues ---------- */
hhsrsReporterRouter.get("/", async (req: Request, res: Response) => {
  const [waitingRows, actionedRows, summary] = await Promise.all([
    prisma.hhsrsSiteSubmission.findMany({
      where: { status: { in: [...HHSRS_WAITING_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.hhsrsSiteSubmission.findMany({
      where: { status: { in: [...HHSRS_ACTIONED_STATUSES] } },
      orderBy: [{ emailSentAt: "desc" }, { updatedAt: "desc" }],
      take: 20,
    }),
    loadSummary(),
  ]);
  const flash = takeFlash(req);
  res.render("hhsrs-reporter/pending", {
    ...shellLocals({ activeNav: "pending", summary, flashOk: flash.ok, flashErr: flash.err }),
    user: req.user,
    waitingRows,
    actionedRows,
  });
});

/* ---------- Review and create (blank) ---------- */
hhsrsReporterRouter.get("/review", async (req: Request, res: Response) => {
  const [summary, alsoWaiting, progress, waitingIds] = await Promise.all([
    loadSummary(),
    prisma.hhsrsSiteSubmission.findMany({
      where: { status: { in: [...HHSRS_WAITING_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    loadProgressProjects(),
    loadWaitingIds(),
  ]);
  const flash = takeFlash(req);
  const signature = signatureLocals(res, await senderSignatureFor(req.user));
  res.render("hhsrs-reporter/review", {
    ...shellLocals({
      activeNav: "review",
      summary,
      title: "Review and create — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    row: null,
    photos: [] as ReporterCasePhoto[],
    draftSubject: "",
    draftBody: "",
    draftTo: "",
    draftCc: "",
    draftBcc: "",
    draftError: "",
    alsoWaiting,
    demoProjects: REPORTER_DEMO_PROJECTS,
    reviewProjectNames: reviewProjectNames(progress, ""),
    reviewProjectValue: "",
    projectAliases: PP_HHSRS_ALIAS,
    waitingIds,
    claim: null as ClaimView | null,
    ratingOptions: RATING_OPTIONS,
    categories: HHSRS_CATEGORIES,
    ratings: HHSRS_RATINGS,
    statuses: HHSRS_CASE_STATUSES,
    callOutcomes: HHSRS_CALL_OUTCOMES,
    onwardTopics: ONWARD_TOPICS,
    matchedProject: null,
    mode: "blank",
    sendConfig: publicSendSettings(false),
    sentEmail: null,
    sentBanner: "",
    ...signature,
  });
});

async function reviewPhotos(
  row: { id: string; photoPaths: unknown },
  storage: SitePhotoStorage
): Promise<Array<ReporterCasePhoto & { bytes: number }>> {
  const photos = reporterCasePhotos(row, HHSRS_REPORTER_PATH);
  return Promise.all(
    photos.map(async (photo) => {
      const bytes = await photoByteSize(row.id, photo.name, storage);
      return { ...photo, bytes: bytes ?? 0 };
    })
  );
}

async function renderReview(
  req: Request,
  res: Response,
  row: NonNullable<Awaited<ReturnType<typeof loadCase>>>,
  opts: {
    flashOk?: string;
    flashErr?: string;
    draftError?: string;
    summary: ReporterSummary;
    alsoWaiting: NonNullable<Awaited<ReturnType<typeof loadCase>>>[];
    progress: ProgressProject[];
    waitingIds: string[];
  }
): Promise<void> {
  const storage = sitePhotoStorageFromApp(req.app);
  const [photos, sentEmail] = await Promise.all([reviewPhotos(row, storage), originalSentEmail(row.id)]);
  const draft = tryDraftFromRow(row);
  const currentNames = opts.progress.filter((project) => project.stage === "current").map((project) => project.name);
  const reviewProjectValue = progressNameForCase(row.projectName, currentNames);
  const matched = matchDemoProject(reviewProjectValue) || matchDemoProject(row.projectName);
  const recipients = await clientRecipientsForProject(reviewProjectValue || row.projectName);
  const flash = takeFlash(req);
  const signatureNames = sentEmail
    ? signatureFromLoggedSender(sentEmail.sentBy)
    : await senderSignatureFor(req.user);
  const signature = signatureLocals(res, signatureNames);
  res.render("hhsrs-reporter/review", {
    ...shellLocals({
      activeNav: "review",
      summary: opts.summary,
      title: "Review and create — " + row.projectName,
      flashOk: opts.flashOk || flash.ok,
      flashErr: opts.flashErr || flash.err,
    }),
    user: req.user,
    row,
    photos,
    draftSubject: draft.subject || row.emailSubject,
    draftBody: draft.body || row.emailBody,
    draftTo: recipients.to,
    draftCc: recipients.cc,
    draftBcc: recipients.bcc,
    draftError: opts.draftError || draft.error,
    alsoWaiting: opts.alsoWaiting.filter((r) => r.id !== row.id),
    demoProjects: REPORTER_DEMO_PROJECTS,
    reviewProjectNames: reviewProjectNames(opts.progress, reviewProjectValue),
    reviewProjectValue,
    projectAliases: PP_HHSRS_ALIAS,
    waitingIds: opts.waitingIds,
    claim: claimView(row),
    ratingOptions: RATING_OPTIONS,
    categories: HHSRS_CATEGORIES,
    ratings: HHSRS_RATINGS,
    statuses: HHSRS_CASE_STATUSES,
    callOutcomes: HHSRS_CALL_OUTCOMES,
    onwardTopics: ONWARD_TOPICS,
    matchedProject: matched,
    mode: "filled",
    sendConfig: publicSendSettings(Boolean(sentEmail)),
    sentEmail,
    sentBanner: sentEmail ? sentBannerText(sentEmail.sentBy, sentEmail.sentAt) : "",
    ...signature,
  });
}

async function reviewContext(excludeId?: string) {
  const [summary, alsoWaiting, progress, waitingIds] = await Promise.all([
    loadSummary(),
    prisma.hhsrsSiteSubmission.findMany({
      where: {
        status: { in: [...HHSRS_WAITING_STATUSES] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    loadProgressProjects(),
    loadWaitingIds(),
  ]);
  return { summary, alsoWaiting, progress, waitingIds };
}

hhsrsReporterRouter.post("/draft.json", async (req: Request, res: Response) => {
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const caseId = String(body.caseId || "").trim();
  const row = caseId ? await loadCase(caseId) : null;
  if (caseId && !row) {
    res.status(404).json({ ok: false, error: "Case not found." });
    return;
  }
  try {
    const fields = mergeReviewDraftFields(row, body);
    const recipients = await clientRecipientsForProject(fields.projectName);
    const draft = draftEmailFromReviewFields(fields, recipients);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, ...draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not prepare the client email.";
    res.status(400).json({ ok: false, error: message });
  }
});

hhsrsReporterRouter.get("/review/:id", async (req: Request, res: Response) => {
  const loaded = await loadCase(req.params.id);
  if (!loaded) {
    res.status(404).send("Case not found.");
    return;
  }
  const row = await claimIfOpen(loaded, claimerLabel(req.user));
  const ctx = await reviewContext(row.id);
  await renderReview(req, res, row, ctx);
});

function findUrl(parts: { q?: string; date?: string; caseId?: string; view?: string; sent?: string }): string {
  const params = new URLSearchParams();
  if (parts.q) params.set("q", parts.q);
  if (parts.date) params.set("date", parts.date);
  if (parts.caseId) params.set("case", parts.caseId);
  if (parts.view) params.set("view", parts.view);
  if (parts.sent) params.set("sent", parts.sent);
  const query = params.toString();
  return `${HHSRS_REPORTER_PATH}/find${query ? `?${query}` : ""}`;
}

function toSentLog(row: Awaited<ReturnType<typeof listSentEmails>>[number]): SentLogEmail {
  return {
    id: row.id,
    sentAt: row.sentAt,
    sentBy: row.sentBy,
    from: row.from,
    to: row.to,
    cc: row.cc,
    bcc: row.bcc,
    subject: row.subject,
    body: row.body,
    photoNames: row.photoNames.map(String),
    kind: row.kind || "original",
    correctionReason: row.correctionReason || "",
    correctionNote: row.correctionNote || "",
    correctsEmailId: row.correctsEmailId || null,
  };
}

/* ---------- Find & resend ---------- */
hhsrsReporterRouter.get("/find", async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  const date = String(req.query.date || "").trim();
  const caseId = String(req.query.case || "").trim();
  const view = String(req.query.view || "").trim() === "amend" ? "amend" : "list";
  const justSent = String(req.query.sent || "") === "1";
  const storage = sitePhotoStorageFromApp(req.app);

  const [summary, matches] = await Promise.all([
    loadSummary(),
    prisma.hhsrsSiteSubmission.findMany({
      where: findCaseWhere(q, date),
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const rows = matches.map((row) => {
    const label = findStatusLabel(row.status);
    return {
      id: row.id,
      reference: row.reference || "",
      submitted: formatLondonDate(row.createdAt),
      uprn: row.uprn,
      address: row.fullAddress,
      hazard: row.category,
      statusLabel: label,
      statusClass: label.replace(/\s+/g, "-"),
      href: findUrl({ q, date, caseId: row.id }),
    };
  });

  const picked = caseId ? matches.find((row) => row.id === caseId) || (await loadCase(caseId)) : null;
  let found: Record<string, unknown> | null = null;
  let amend: Record<string, unknown> | null = null;
  let photos: ReporterCasePhoto[] = [];

  if (picked) {
    const emails = (await listSentEmails(picked.id)).map(toSentLog);
    const latest = latestSentLog(emails);
    const label = findStatusLabel(picked.status);
    const casePhotos = await reviewPhotos(picked, storage);
    const log = mainLogCardRows(emails).map((entry) => ({
      ...entry,
      fresh: justSent && latest ? entry.id === latest.id && entry.type === "Correction" : false,
    }));
    const sent = latest
      ? {
          when: formatLondonDateTime(latest.sentAt),
          by: latest.sentBy,
          from: latest.from,
          to: latest.to,
          cc: latest.cc,
          bcc: latest.bcc,
          subject: latest.subject,
          body: latest.body,
          bodyMissing: !String(latest.body || "").trim(),
          missingText: MISSING_EMAIL_BODY,
          correction: latest.kind === "correction",
          photos: latest.photoNames.map((name, index) => {
            const known = casePhotos.find((photo) => photo.name === name);
            return known || { id: name, name, caption: `Photo ${index + 1}`, url: "" };
          }),
        }
      : null;
    const notice =
      justSent && latest
        ? `Sent to ${latest.to} at ${formatLondonDateTime(latest.sentAt)}. Status is now Corrected and the Main Log is updated below.`
        : "";
    found = {
      id: picked.id,
      reference: picked.reference || "",
      address: picked.fullAddress,
      hazard: picked.category,
      statusLabel: label,
      statusClass: label.replace(/\s+/g, "-"),
      reviewUrl: `${HHSRS_REPORTER_PATH}/review/${picked.id}`,
      amendUrl: findUrl({ q, date, caseId: picked.id, view: "amend" }),
      backUrl: findUrl({ q, date, caseId: picked.id }),
      viewUrl: findUrl({ q, date, caseId: picked.id }),
      sent,
      notice,
      log,
    };
    if (view === "amend" && latest) {
      const included = new Set(latest.photoNames);
      photos = casePhotos;
      amend = {
        to: latest.to,
        cc: latest.cc,
        bcc: latest.bcc,
        subject: correctionSubject(latest.subject),
        body: latest.body,
        reasons: CORRECTION_REASONS,
        note: "",
        includedCount: casePhotos.filter((photo) => included.has(photo.name)).length,
        photos: casePhotos.map((photo, index) => ({
          ...photo,
          caption: photo.caption || `Photo ${index + 1}`,
          included: included.has(photo.name),
        })),
        action: `${HHSRS_REPORTER_PATH}/find/${picked.id}/resend`,
      };
    }
  }

  const flash = takeFlash(req);
  res.render("hhsrs-reporter/find", {
    ...shellLocals({
      activeNav: "find",
      summary,
      title: "Find & resend — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    filters: { q, date },
    rows,
    found,
    view: amend ? "amend" : "list",
    amend,
    photos,
    sendConfig: publicSendSettings(false),
    findResend: Boolean(amend),
  });
});

hhsrsReporterRouter.post("/find/:id/resend", async (req: Request, res: Response) => {
  const row = await loadCase(req.params.id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const q = String(body.q || "").trim();
  const date = String(body.date || "").trim();
  const signature = await senderSignatureFor(req.user);
  const result = await sendCaseEmail({
    row,
    sentBy: signature.fullName || req.user?.username || "",
    senderFirstName: signature.firstName,
    senderFullName: signature.fullName,
    hasReporterAccess: Boolean(req.user && isAdmin(req.user)),
    body,
    storage: sitePhotoStorageFromApp(req.app),
    correction: {
      reason: String(body.correctionReason || ""),
      note: String(body.correctionNote || ""),
    },
  });
  if (!result.ok) flashErr(req, result.error);
  res.redirect(findUrl({ q, date, caseId: row.id, view: result.ok ? undefined : "amend", sent: result.ok ? "1" : undefined }));
});

function mainLogHref(filters: MainLogFilters, patch: Partial<MainLogFilters> = {}): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.project) params.set("project", next.project);
  if (next.by) params.set("by", next.by);
  if (next.type) params.set("type", next.type);
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.open) params.set("open", next.open);
  const qs = params.toString();
  return `${HHSRS_REPORTER_PATH}/main-log${qs ? `?${qs}` : ""}`;
}

function mainLogExportHref(filters: MainLogFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.project) params.set("project", filters.project);
  if (filters.by) params.set("by", filters.by);
  if (filters.type) params.set("type", filters.type);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = params.toString();
  return `${HHSRS_REPORTER_PATH}/main-log/export.xlsx${qs ? `?${qs}` : ""}`;
}

/* ---------- Main Log ---------- */
hhsrsReporterRouter.get("/main-log", async (req: Request, res: Response) => {
  const [loaded, summary] = await Promise.all([
    loadMainLog(req.query as Record<string, unknown>),
    loadSummary(),
  ]);
  const filters = loaded.filters;
  const flash = takeFlash(req);
  const rows = loaded.entries.map((entry) => {
    const flag = loaded.flags.get(entry.key);
    return {
      ...entry,
      href: mainLogHref(filters, { open: entry.key }),
      selected: filters.open === entry.key,
      whenDate: formatLondonDateTime(entry.at).split(" ")[0],
      whenTime: formatLondonDateTime(entry.at).split(" ")[1],
      typeLabel: mainLogTypeLabel(entry.kind),
      ratingClass: ratingDisplayClass(entry.rating),
      correctedNote: Boolean(flag?.showCorrectedNote),
      hasCorrBelow: Boolean(flag?.hasCorrBelow),
      linkLine: correctionLinkLine(entry),
    };
  });
  const panelEntry = loaded.panel;
  const panel = panelEntry
    ? {
        ...panelEntry,
        typeLabel: mainLogTypeLabel(panelEntry.kind),
        ratingClass: ratingDisplayClass(panelEntry.rating),
        when: formatLondonDateTime(panelEntry.at),
        originalWhen: panelEntry.originalSentAt ? formatLondonDateTime(panelEntry.originalSentAt) : "",
        photos: casePhotoViews(panelEntry, HHSRS_REPORTER_PATH),
        caseHref: `${HHSRS_REPORTER_PATH}/review/${panelEntry.submissionId}`,
        originalHref: panelEntry.correctsKey ? mainLogHref(filters, { open: panelEntry.correctsKey }) : "",
        closeHref: mainLogHref(filters, { open: "" }),
        corrections: panelEntry.corrections.map((item) => ({
          ...item,
          when: formatLondonDateTime(item.at),
          href: mainLogHref(filters, { open: item.key }),
        })),
        bodyMissing: panelEntry.kind !== "not_sent" && !panelEntry.body.trim(),
        bodyText: panelEntry.body.trim()
          ? panelEntry.body
          : panelEntry.kind === "not_sent"
            ? ""
            : MISSING_EMAIL_BODY,
      }
    : null;
  res.render("hhsrs-reporter/main-log", {
    ...shellLocals({
      activeNav: "main-log",
      summary,
      title: "Main Log — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    rows,
    panel,
    projectNames: loaded.projectNames,
    senders: loaded.senders,
    filters,
    mailbox: fromAddressFromEnv(),
    showing: showingLabel(loaded.total, loaded.from, loaded.to, loaded.unfiltered, filtersActive(filters)),
    ofTotal: filtersActive(filters) && loaded.unfiltered > loaded.total && loaded.from <= 1 && loaded.to === loaded.total
      ? loaded.unfiltered
      : 0,
    exportHref: mainLogExportHref(filters),
    clearHref: `${HHSRS_REPORTER_PATH}/main-log`,
    prevHref: loaded.page > 1 ? mainLogHref(filters, { page: loaded.page - 1 }) : "",
    nextHref: loaded.page < loaded.pageCount ? mainLogHref(filters, { page: loaded.page + 1 }) : "",
    page: loaded.page,
    pageCount: loaded.pageCount,
    mainLogJsUrl: typeof res.locals.baseUrl === "function" ? res.locals.baseUrl("/js/hhsrs-main-log.js") : "/js/hhsrs-main-log.js",
  });
});

hhsrsReporterRouter.get("/main-log/export.xlsx", async (req: Request, res: Response) => {
  const loaded = await loadMainLogExport(req.query as Record<string, unknown>);
  const names = senderNamesFromLogin(req.user);
  const file = await buildMainLogWorkbook({
    entries: loaded.entries,
    filters: loaded.filters,
    exportedBy: names.sentBy || "HHSRS",
    exportedAt: new Date(),
  });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="hhsrs-main-log.xlsx"');
  res.send(file);
});

hhsrsReporterRouter.get("/main-log/:id", async (req: Request, res: Response) => {
  const row = await loadCase(req.params.id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const sent = await originalSentEmail(row.id);
  if (sent) {
    res.redirect(`${HHSRS_REPORTER_PATH}/main-log?open=email:${encodeURIComponent(sent.id)}`);
    return;
  }
  if ((HHSRS_ACTIONED_STATUSES as readonly string[]).includes(row.status)) {
    res.redirect(`${HHSRS_REPORTER_PATH}/main-log?open=case:${encodeURIComponent(row.id)}`);
    return;
  }
  res.redirect(`${HHSRS_REPORTER_PATH}/main-log`);
});

async function loadLiveProjectCounts(): Promise<{
  hasLiveSubmissions: boolean;
  liveCounts: Record<string, LiveProjectCounts>;
}> {
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    select: { projectName: true, status: true },
  });
  const liveCounts: Record<string, LiveProjectCounts> = {};
  for (const row of rows) {
    const name = (row.projectName || "").trim();
    if (!name) continue;
    const bucket = liveCounts[name] || { waiting: 0, completed: 0 };
    if ((HHSRS_WAITING_STATUSES as readonly string[]).includes(row.status)) bucket.waiting += 1;
    else if ((HHSRS_ACTIONED_STATUSES as readonly string[]).includes(row.status)) bucket.completed += 1;
    liveCounts[name] = bucket;
  }
  return { hasLiveSubmissions: rows.length > 0, liveCounts };
}

async function loadProjectOverview(): Promise<ProjectOverview> {
  const [live, projects] = await Promise.all([loadLiveProjectCounts(), loadProgressProjects()]);
  return buildProjectOverview({ projects, liveCounts: live.liveCounts });
}

/* ---------- Project overview ---------- */
hhsrsReporterRouter.get("/project-overview", async (req: Request, res: Response) => {
  const [summary, overview] = await Promise.all([loadSummary(), loadProjectOverview()]);
  const flash = takeFlash(req);
  res.render("hhsrs-reporter/project-overview", {
    ...shellLocals({
      activeNav: "project-overview",
      summary,
      title: "Project overview — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    overview,
    poToast: flash.po,
  });
});

hhsrsReporterRouter.post("/project-overview/archive", async (req: Request, res: Response) => {
  flashPo(req, PROJECT_PROGRESS_CHANGE_TOAST);
  res.redirect(`${HHSRS_REPORTER_PATH}/project-overview`);
});

hhsrsReporterRouter.post("/project-overview/restore", async (req: Request, res: Response) => {
  flashPo(req, PROJECT_PROGRESS_CHANGE_TOAST);
  res.redirect(`${HHSRS_REPORTER_PATH}/project-overview`);
});

function takeAccessFlash(req: Request): { ok: string; err: string } {
  const ok = req.session?.flashAccessCode || "";
  const err = req.session?.flashAccessCodeErr || "";
  if (req.session) {
    delete req.session.flashAccessCode;
    delete req.session.flashAccessCodeErr;
  }
  return { ok, err };
}

function takeClientEmailFlash(req: Request): ClientEmailFlash | null {
  const flash = req.session?.flashClientEmail || null;
  if (req.session) delete req.session.flashClientEmail;
  return flash;
}

/* ---------- Admin ---------- */
hhsrsReporterRouter.get("/admin", async (req: Request, res: Response) => {
  const clientFlash = takeClientEmailFlash(req);
  const [summary, access, clientEmailCards] = await Promise.all([
    loadSummary(),
    loadSiteFormAccess(),
    loadClientEmailCards(clientFlash),
  ]);
  const flash = takeFlash(req);
  const accessFlash = takeAccessFlash(req);
  res.render("hhsrs-reporter/admin", {
    ...shellLocals({
      activeNav: "admin",
      summary,
      title: "Admin — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    siteFormAccessCode: access.code,
    siteFormAccessChangedLine: accessChangedLine(access),
    siteFormAccessSaved: accessFlash.ok === SITE_FORM_CODE_CHANGED,
    siteFormAccessError: accessFlash.err,
    siteFormAccessEditing: Boolean(accessFlash.err),
    clientEmailCards,
    clientEmailFormError: unmatchedClientEmailError(REPORTER_DEMO_PROJECTS, clientFlash),
  });
});

hhsrsReporterRouter.post("/admin/site-form-access", async (req: Request, res: Response) => {
  const name = String(req.user?.name || req.user?.username || "").trim();
  try {
    await changeSiteFormAccessCode(String(req.body?.code ?? ""), name);
    req.session = req.session || {};
    req.session.flashAccessCode = SITE_FORM_CODE_CHANGED;
  } catch (err) {
    req.session = req.session || {};
    req.session.flashAccessCodeErr = err instanceof SiteFormAccessError ? err.message : SITE_FORM_CODE_INVALID;
  }
  res.redirect(`${HHSRS_REPORTER_PATH}/admin`);
});

hhsrsReporterRouter.post("/admin/client-emails", async (req: Request, res: Response) => {
  const projectName = String(req.body?.projectName ?? "");
  const toText = String(req.body?.to ?? "");
  const ccText = String(req.body?.cc ?? "");
  const bccText = String(req.body?.bcc ?? "");
  const name = String(req.user?.name || req.user?.username || "").trim();
  const result = await saveClientEmail({
    projectName,
    toRaw: toText,
    ccRaw: ccText,
    bccRaw: bccText,
    changedByName: name,
  });
  req.session = req.session || {};
  req.session.flashClientEmail = result.ok
    ? { projectName: projectName.trim(), saved: true, error: "", toText: "", ccText: "", bccText: "" }
    : { projectName: projectName.trim(), saved: false, error: result.error, toText, ccText, bccText };
  res.redirect(`${HHSRS_REPORTER_PATH}/admin#client-email-card`);
});

/* ---------- Case save and send (canonical under /review/:id) ---------- */
hhsrsReporterRouter.post("/review/:id", async (req: Request, res: Response) => {
  await handleSave(req, res, req.params.id);
});

hhsrsReporterRouter.post("/review/:id/mark-actioned", (_req: Request, res: Response) => {
  res.status(410).type("text/plain").send("Gone.");
});

hhsrsReporterRouter.post("/review/:id/send", async (req: Request, res: Response) => {
  await handleSend(req, res, req.params.id);
});

hhsrsReporterRouter.post("/review/:id/abandon", async (req: Request, res: Response) => {
  await handleAbandon(req, res, req.params.id);
});

/* Back-compat paths from PR #20 */
hhsrsReporterRouter.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (["review", "find", "main-log", "admin", "project-overview"].includes(id)) {
    res.status(404).send("Not found.");
    return;
  }
  res.redirect(`${HHSRS_REPORTER_PATH}/review/${id}`);
});

hhsrsReporterRouter.post("/:id", async (req: Request, res: Response) => {
  await handleSave(req, res, req.params.id);
});

hhsrsReporterRouter.post("/:id/mark-sent", (_req: Request, res: Response) => {
  res.status(410).type("text/plain").send("Gone.");
});

hhsrsReporterRouter.post("/:id/mark-actioned", (_req: Request, res: Response) => {
  res.status(410).type("text/plain").send("Gone.");
});

async function handleSave(req: Request, res: Response, id: string): Promise<void> {
  const row = await loadCase(id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const ctx = await reviewContext(row.id);
  const update = readReporterUpdate(req.body || {});
  // Site-form ratings stay Low/Medium/High; allow keeping an existing non-standard value.
  if (!isHhsrsRating(update.rating) && update.rating !== row.rating) {
    await renderReview(req, res, row, {
      ...ctx,
      flashErr: "Select a valid rating for this case.",
    });
    return;
  }
  if (
    update.callOutcome &&
    !(HHSRS_CALL_OUTCOMES as readonly string[]).includes(update.callOutcome)
  ) {
    await renderReview(req, res, row, { ...ctx, flashErr: "Select a valid call outcome." });
    return;
  }

  const expected = update.expectedUpdatedAt ? new Date(update.expectedUpdatedAt) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    await renderReview(req, res, row, {
      ...ctx,
      flashErr: "Missing concurrency token. Reload the case and try again.",
    });
    return;
  }
  if (row.updatedAt.getTime() !== expected.getTime()) {
    await renderReview(req, res, row, {
      ...ctx,
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
    callNotes: update.callNotes,
    workOrder: update.workOrder,
    suspectedCause: update.suspectedCause,
    includeCause: update.includeCause,
    vulnerabilities: update.vulnerabilities,
    escalation: update.escalation,
    onwardTopic: update.onwardTopic,
    cat1Confirmed: update.cat1Confirmed,
    internalNotes: update.internalNotes,
    status: statusForReviewSave(row.status, update.status),
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
    await renderReview(req, res, fresh, {
      ...(await reviewContext(fresh.id)),
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then save again.",
    });
    return;
  }

  flashOk(req, "Case saved.");
  res.redirect(`${HHSRS_REPORTER_PATH}/review/${row.id}`);
}

function flashErr(req: Request, message: string): void {
  req.session = req.session || {};
  req.session.flashErr = message;
}

async function handleSend(req: Request, res: Response, id: string): Promise<void> {
  const row = await loadCase(id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const user = req.user;
  const signature = await senderSignatureFor(user);
  const rawBody = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const stored = await clientRecipientsForProject(String(rawBody.projectName || row.projectName || ""));
  const result = await sendCaseEmail({
    row,
    sentBy: signature.fullName || user?.username || "",
    senderFirstName: signature.firstName,
    senderFullName: signature.fullName,
    hasReporterAccess: Boolean(user && isAdmin(user)),
    body: sendBodyWithClientRecipients(rawBody, stored),
    storage: sitePhotoStorageFromApp(req.app),
  });
  if (!result.ok) {
    flashErr(req, result.error);
    res.redirect(`${HHSRS_REPORTER_PATH}/review/${row.id}`);
    return;
  }
  flashOk(req, "Sent and logged.");
  // The email is already sent. Copy must not undo that, and a slow or failed
  // Spaces upload must not hold the redirect open.
  await archiveLoggedPhotos(req, row.id);
  res.redirect(`${HHSRS_REPORTER_PATH}/review/${row.id}`);
}

/** Tests replace this with a stub. Production copies into Spaces. */
export const HHSRS_PHOTO_COPY = "hhsrsPhotoCopy";
const HHSRS_PHOTO_COPY_WAIT_MS = 20_000;

async function archiveLoggedPhotos(req: Request, submissionId: string): Promise<void> {
  const custom = req.app.get(HHSRS_PHOTO_COPY);
  const run =
    typeof custom === "function"
      ? (custom as (id: string) => Promise<unknown>)
      : copyLoggedHhsrsPhotos;
  const task = Promise.resolve()
    .then(() => run(submissionId))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`HHSRS photo copy failed for ${submissionId}: ${message}`);
    });
  await Promise.race([task, new Promise<void>((resolve) => setTimeout(resolve, HHSRS_PHOTO_COPY_WAIT_MS))]);
}

async function handleAbandon(req: Request, res: Response, id: string): Promise<void> {
  const row = await loadCase(id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  if (isWaitingStatus(row.status)) {
    await prisma.hhsrsSiteSubmission.update({
      where: { id: row.id },
      data: { claimedBy: "", claimedAt: null },
    });
  }
  res.redirect(HHSRS_REPORTER_PATH);
}

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
  const loaded = await loadSiteFormPhoto(expected, sitePhotoStorageFromApp(req.app));
  if (!loaded) {
    res.status(404).send("Photo not found.");
    return;
  }
  const headers = privateInlineHeaders(loaded.fileName, loaded.body.length, loaded.contentType);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.status(200).send(loaded.body);
});

/* Photos under /review/:id/photos/:name */
hhsrsReporterRouter.get("/review/:id/photos/:name", async (req: Request, res: Response) => {
  req.url = `/${req.params.id}/photos/${req.params.name}`;
  // Reuse by redirecting to canonical photo URL
  res.redirect(`${HHSRS_REPORTER_PATH}/${req.params.id}/photos/${encodeURIComponent(req.params.name)}`);
});
