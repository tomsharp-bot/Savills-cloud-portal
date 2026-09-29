import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { formatDocDate } from "../lib/dates.js";
import {
  HHSRS_CATEGORIES,
  HHSRS_RATINGS,
  HHSRS_SITE_FORM_RATINGS,
  isHhsrsRating,
} from "../lib/hhsrs-categories.js";
import {
  CALL_REF_BLANK_REASONS,
  HHSRS_MAX_PHOTOS,
  hhsrsMulterLimits,
  hhsrsPhotoSizeError,
  isCallRefBlankReason,
  safeId,
  safeStoredName,
  splitCallNotes,
} from "../lib/hhsrs-site-form.js";
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
  isHhsrsCaseStatus,
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
  HHSRS_PORTAL_NAME_ALIASES,
  RATING_OPTIONS,
  SITE_FORM_PUBLIC_URL,
  hhsrsProjectSettings,
  portalNameInList,
  resolveHhsrsProject,
} from "../lib/hhsrs-reporter-projects.js";
import { loadPortalProjectNames, storedNamesForPortalProject } from "../lib/hhsrs-portal-projects.js";
import {
  PROJECT_PROGRESS_CHANGE_TOAST,
  buildProjectOverview,
  type LiveProjectCounts,
  type ProgressProject,
  type ProjectOverview,
} from "../lib/hhsrs-reporter-overview.js";
import { pendingAlertSummary } from "../lib/hhsrs-pending-alerts.js";
import { pendingIssueListArgs, withoutOpenCase } from "../lib/hhsrs-pending-list.js";
import { claimRowClass, claimView, claimerLabel, type ClaimView } from "../lib/hhsrs-claims.js";
import { isAdmin, type AuthedUser } from "../lib/access.js";
import {
  fromAddressFromEnv,
  publicSendSettings,
  REVIEW_SENT_CONFIRMATION,
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
  MAIN_LOG_COLUMNS,
  mainLogTypeLabel,
  showingLabel,
  type MainLogFilters,
  type MainLogSortKey,
} from "../lib/hhsrs-main-log.js";
import {
  NOT_NEEDED_REASONS,
  loadDuplicates,
  moveCaseToNotNeeded,
  restoreCaseToPending,
} from "../lib/hhsrs-not-needed.js";
import { createOfficeCaseAndSend } from "../lib/hhsrs-office-case.js";
import {
  loadSiteFormPhoto,
  privateInlineHeaders,
  sitePhotoStorageFromApp,
  type SitePhotoStorage,
} from "../lib/hhsrs-site-photos.js";
import {
  SIGNATURE_LOGO_PUBLIC_PATH,
  renderSignatureHtml,
  resolveSenderSignature,
  signatureFromLoggedSender,
  type SenderSignature,
} from "../lib/hhsrs-signature.js";

function signatureLogoUrl(res: Response): string {
  if (typeof res.locals.baseUrl === "function") {
    return res.locals.baseUrl(SIGNATURE_LOGO_PUBLIC_PATH);
  }
  return SIGNATURE_LOGO_PUBLIC_PATH;
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
  const html = renderSignatureHtml(names, signatureLogoUrl(res));
  return {
    signatureHtml: html,
    emailSignature: {
      missing: false,
      warning: "",
      html,
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
  res.locals.logoUrl = SIGNATURE_LOGO_PUBLIC_PATH;
  // Logo is served from portal static; prefer baseUrl when available.
  if (typeof res.locals.baseUrl === "function") {
    res.locals.logoUrl = res.locals.baseUrl(SIGNATURE_LOGO_PUBLIC_PATH);
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
  const [waiting, inReview, actionedMonth, mainLog, duplicates] = await Promise.all([
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
    prisma.hhsrsSiteSubmission.count({ where: { status: "not_needed" } }),
  ]);
  return { waiting, inReview, actionedMonth, mainLog, duplicates };
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

function settingsForProjects(names: readonly string[]) {
  return names.map((name) => hhsrsProjectSettings(name));
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
  activeNav: "pending" | "review" | "find" | "main-log" | "duplicates" | "admin" | "project-overview";
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
  const waitingWhere = { status: { in: [...HHSRS_WAITING_STATUSES] } };
  const [rows, waitingCount] = await Promise.all([
    prisma.hhsrsSiteSubmission.findMany({
      where: waitingWhere,
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
    }),
    prisma.hhsrsSiteSubmission.count({ where: waitingWhere }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    waitingCount,
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
    prisma.hhsrsSiteSubmission.findMany(pendingIssueListArgs()),
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
    prisma.hhsrsSiteSubmission.findMany(pendingIssueListArgs()),
    loadProgressProjects(),
    loadWaitingIds(),
  ]);
  const flash = takeFlash(req);
  const signature = signatureLocals(res, await senderSignatureFor(req.user));
  const blankProjects = reviewProjectNames(progress, "");
  res.render("hhsrs-reporter/review", {
    ...shellLocals({
      activeNav: "review",
      summary,
      title: "Review & Create — HHSRS Reporter",
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
    demoProjects: settingsForProjects(blankProjects),
    reviewProjectNames: blankProjects,
    reviewProjectValue: "",
    projectAliases: HHSRS_PORTAL_NAME_ALIASES,
    waitingIds,
    claim: null as ClaimView | null,
    ratingOptions: RATING_OPTIONS,
    categories: HHSRS_CATEGORIES,
    ratings: HHSRS_RATINGS,
    statuses: HHSRS_CASE_STATUSES,
    callOutcomes: HHSRS_CALL_OUTCOMES,
    callBlankReasons: CALL_REF_BLANK_REASONS,
    callBlank: { reason: "", note: "" },
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
  const reviewProjectValue = portalNameInList(row.projectName, currentNames);
  const projectList = reviewProjectNames(opts.progress, reviewProjectValue);
  const matched = resolveHhsrsProject(reviewProjectValue || row.projectName).roster;
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
      title: "Review & Create — " + row.projectName,
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
    alsoWaiting: withoutOpenCase(opts.alsoWaiting, row.id),
    demoProjects: settingsForProjects(projectList),
    reviewProjectNames: projectList,
    reviewProjectValue,
    projectAliases: HHSRS_PORTAL_NAME_ALIASES,
    waitingIds: opts.waitingIds,
    claim: claimView(row),
    ratingOptions: RATING_OPTIONS,
    categories: HHSRS_CATEGORIES,
    ratings: HHSRS_RATINGS,
    statuses: HHSRS_CASE_STATUSES,
    callOutcomes: HHSRS_CALL_OUTCOMES,
    callBlankReasons: CALL_REF_BLANK_REASONS,
    callBlank: splitCallNotes(row.callNotes || ""),
    onwardTopics: ONWARD_TOPICS,
    matchedProject: matched,
    mode: "filled",
    sendConfig: publicSendSettings(Boolean(sentEmail)),
    sentEmail,
    sentBanner: sentEmail ? sentBannerText(sentEmail.sentBy, sentEmail.sentAt) : "",
    ...signature,
    notNeededReasons: NOT_NEEDED_REASONS,
  });
}

async function reviewContext(excludeId?: string) {
  const [summary, pendingRows, progress, waitingIds] = await Promise.all([
    loadSummary(),
    prisma.hhsrsSiteSubmission.findMany(pendingIssueListArgs()),
    loadProgressProjects(),
    loadWaitingIds(),
  ]);
  return { summary, alsoWaiting: withoutOpenCase(pendingRows, excludeId), progress, waitingIds };
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

function findUrl(parts: { q?: string; date?: string; project?: string; caseId?: string; view?: string; sent?: string }): string {
  const params = new URLSearchParams();
  if (parts.q) params.set("q", parts.q);
  if (parts.date) params.set("date", parts.date);
  if (parts.project) params.set("project", parts.project);
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
  const project = String(req.query.project || "").trim();
  const caseId = String(req.query.case || "").trim();
  const view = String(req.query.view || "").trim() === "amend" ? "amend" : "list";
  const justSent = String(req.query.sent || "") === "1";
  const storage = sitePhotoStorageFromApp(req.app);
  const projectNames = await loadPortalProjectNames();
  if (project && !projectNames.some((name) => name === project)) projectNames.push(project);
  const where = findCaseWhere(q, date);
  if (project) {
    const names = await storedNamesForPortalProject(project);
    const projectWhere = { projectName: { in: names.length ? names : [project] } };
    where.AND = Array.isArray(where.AND) ? [...where.AND, projectWhere] : [projectWhere];
  }

  const [summary, matches] = await Promise.all([
    loadSummary(),
    prisma.hhsrsSiteSubmission.findMany({
      where,
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
      href: findUrl({ q, date, project, caseId: row.id }),
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
      amendUrl: findUrl({ q, date, project, caseId: picked.id, view: "amend" }),
      backUrl: findUrl({ q, date, project, caseId: picked.id }),
      viewUrl: findUrl({ q, date, project, caseId: picked.id }),
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
  const signature = signatureLocals(res, await senderSignatureFor(req.user));
  res.render("hhsrs-reporter/find", {
    ...shellLocals({
      activeNav: "find",
      summary,
      title: "Find & Resend — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    filters: { q, date, project },
    projectNames,
    rows,
    found,
    view: amend ? "amend" : "list",
    amend,
    photos,
    sendConfig: publicSendSettings(false),
    findResend: Boolean(amend),
    ...signature,
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
  const project = String(body.project || "").trim();
  const signature = await senderSignatureFor(req.user);
  const stored = await clientRecipientsForProject(row.projectName);
  const sendBody = sendBodyWithClientRecipients(body, stored);
  const result = await sendCaseEmail({
    row,
    sentBy: signature.fullName || req.user?.username || "",
    senderFirstName: signature.firstName,
    senderFullName: signature.fullName,
    hasReporterAccess: Boolean(req.user && isAdmin(req.user)),
    body: sendBody,
    storage: sitePhotoStorageFromApp(req.app),
    correction: {
      reason: String(body.correctionReason || ""),
      note: String(body.correctionNote || ""),
    },
  });
  if (!result.ok) flashErr(req, result.error);
  res.redirect(findUrl({ q, date, project, caseId: row.id, view: result.ok ? undefined : "amend", sent: result.ok ? "1" : undefined }));
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
  if (next.sort) {
    params.set("sort", next.sort);
    params.set("dir", next.dir === "desc" ? "desc" : "asc");
  }
  if (next.page > 1) params.set("page", String(next.page));
  if (next.open) params.set("open", next.open);
  const qs = params.toString();
  return `${HHSRS_REPORTER_PATH}/main-log${qs ? `?${qs}` : ""}`;
}

function mainLogSortTitle(key: MainLogSortKey, label: string, active: boolean, dir: MainLogFilters["dir"]): string {
  if (!active) return `Sort by ${label}`;
  if (key === "sent") return dir === "desc" ? "Sorted newest first. Click to reverse." : "Sorted oldest first. Click to reverse.";
  if (key === "photos") return dir === "desc" ? "Sorted most first. Click to reverse." : "Sorted fewest first. Click to reverse.";
  return dir === "desc" ? "Sorted Z to A. Click to reverse." : "Sorted A to Z. Click to reverse.";
}

function mainLogSortColumns(filters: MainLogFilters) {
  return MAIN_LOG_COLUMNS.map((col) => {
    const active = filters.sort === col.key;
    const dir = active && filters.dir === "desc" ? "desc" : "asc";
    const nextDir = active && dir === "asc" ? "desc" : "asc";
    return {
      key: col.key,
      label: col.label,
      className: col.className,
      active,
      dir: active ? dir : "",
      title: mainLogSortTitle(col.key, col.label, active, dir),
      href: mainLogHref(filters, { sort: col.key, dir: nextDir, page: 1, open: "" }),
    };
  });
}

function mainLogExportHref(filters: MainLogFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.project) params.set("project", filters.project);
  if (filters.by) params.set("by", filters.by);
  if (filters.type) params.set("type", filters.type);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.sort) {
    params.set("sort", filters.sort);
    params.set("dir", filters.dir === "desc" ? "desc" : "asc");
  }
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
    sortColumns: mainLogSortColumns(filters),
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
      title: "Project Overview — HHSRS Reporter",
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

function takeClientEmailFlash(req: Request): ClientEmailFlash | null {
  const flash = req.session?.flashClientEmail || null;
  if (req.session) delete req.session.flashClientEmail;
  return flash;
}

/* ---------- Admin ---------- */
hhsrsReporterRouter.get("/admin", async (req: Request, res: Response) => {
  const clientFlash = takeClientEmailFlash(req);
  const [summary, clientEmailCards] = await Promise.all([
    loadSummary(),
    loadClientEmailCards(clientFlash),
  ]);
  const flash = takeFlash(req);
  res.render("hhsrs-reporter/admin", {
    ...shellLocals({
      activeNav: "admin",
      summary,
      title: "Admin — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    clientEmailCards,
    clientEmailFormError: unmatchedClientEmailError(
      clientEmailCards.map((card) => ({ name: card.projectName })),
      clientFlash
    ),
  });
});

function postedAddressBox(body: unknown, key: string, legacy: string): string {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (Object.prototype.hasOwnProperty.call(record, key)) return String(record[key] ?? "");
  return String(record[legacy] ?? "");
}

hhsrsReporterRouter.post("/admin/client-emails", async (req: Request, res: Response) => {
  const postedName = String(req.body?.projectName ?? "").trim();
  const toText = postedAddressBox(req.body, "hhsrs-to", "to");
  const ccText = postedAddressBox(req.body, "hhsrs-cc", "cc");
  const bccText = postedAddressBox(req.body, "hhsrs-bcc", "bcc");
  const name = String(req.user?.name || req.user?.username || "").trim();
  const result = await saveClientEmail({
    projectName: postedName,
    toRaw: toText,
    ccRaw: ccText,
    bccRaw: bccText,
    changedByName: name,
  });
  req.session = req.session || {};
  req.session.flashClientEmail = result.ok
    ? { projectName: result.projectName, saved: true, error: "", toText: "", ccText: "", bccText: "" }
    : { projectName: postedName, saved: false, error: result.error, toText, ccText, bccText };
  res.redirect(`${HHSRS_REPORTER_PATH}/admin#client-email-card`);
});

/* ---------- Case save and send (canonical under /review/:id) ---------- */
hhsrsReporterRouter.post("/review/office-send", uploadOfficePhotos, async (req: Request, res: Response) => {
  await handleOfficeSend(req, res);
});

hhsrsReporterRouter.post("/review/:id", async (req: Request, res: Response) => {
  await handleSave(req, res, req.params.id);
});

hhsrsReporterRouter.post("/review/:id/mark-actioned", (_req: Request, res: Response) => {
  res.status(410).type("text/plain").send("Gone.");
});

hhsrsReporterRouter.post("/review/:id/send", async (req: Request, res: Response) => {
  await handleSend(req, res, req.params.id);
});

hhsrsReporterRouter.post("/review/:id/not-needed", async (req: Request, res: Response) => {
  await handleNotNeeded(req, res, req.params.id);
});

hhsrsReporterRouter.get("/duplicates", async (req: Request, res: Response) => {
  await handleDuplicates(req, res);
});

hhsrsReporterRouter.post("/duplicates/:id/restore", async (req: Request, res: Response) => {
  await handleRestore(req, res, req.params.id);
});

hhsrsReporterRouter.post("/review/:id/abandon", async (req: Request, res: Response) => {
  await handleAbandon(req, res, req.params.id);
});

/* Back-compat paths from PR #20 */
hhsrsReporterRouter.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (["review", "find", "main-log", "duplicates", "admin", "project-overview"].includes(id)) {
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
  if (!isHhsrsCaseStatus(update.status)) {
    await renderReview(req, res, row, { ...ctx, flashErr: "Select a valid case status." });
    return;
  }
  const posted = (req.body || {}) as Record<string, unknown>;
  const postedRef = String(posted.clientCallReference ?? "").trim();
  const postedReason = String(posted.callRefBlankReason ?? "").trim();
  if (Object.prototype.hasOwnProperty.call(posted, "callRefBlankReason") && !postedRef) {
    const otherWithoutNote = postedReason === "Other" && !String(posted.callNotes ?? "").trim();
    if ((postedReason && !isCallRefBlankReason(postedReason)) || otherWithoutNote) {
      await renderReview(req, res, row, { ...ctx, flashErr: "Say why the call reference is blank." });
      return;
    }
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

/** Tests replace the portal send. Production uses sendCaseEmail. */
export const HHSRS_CASE_SEND = "hhsrsCaseSend";

async function deliverCaseEmail(
  req: Request,
  row: NonNullable<Awaited<ReturnType<typeof loadCase>>>,
  body: Record<string, unknown>
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const custom = req.app.get(HHSRS_CASE_SEND);
  const signature = await senderSignatureFor(req.user);
  const sentBy = signature.fullName || req.user?.username || "";
  const stored = await clientRecipientsForProject(String(body.projectName || row.projectName || ""));
  const sendBody = sendBodyWithClientRecipients(body, stored);
  if (typeof custom === "function") {
    return (custom as (args: {
      row: typeof row;
      body: Record<string, unknown>;
      sentBy: string;
    }) => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>)({
      row,
      body: sendBody,
      sentBy,
    });
  }
  return sendCaseEmail({
    row,
    sentBy,
    senderFirstName: signature.firstName,
    senderFullName: signature.fullName,
    hasReporterAccess: Boolean(req.user && isAdmin(req.user)),
    body: sendBody,
    storage: sitePhotoStorageFromApp(req.app),
  });
}

async function handleSend(req: Request, res: Response, id: string): Promise<void> {
  const row = await loadCase(id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const result = await deliverCaseEmail(
    req,
    row,
    (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>
  );
  if (!result.ok) {
    flashErr(req, result.error);
    res.redirect(`${HHSRS_REPORTER_PATH}/review/${row.id}`);
    return;
  }
  flashOk(req, REVIEW_SENT_CONFIRMATION);
  // The email is already sent. Copy must not undo that, and a slow or failed
  // Spaces upload must not hold the redirect open.
  await archiveLoggedPhotos(req, row.id);
  res.redirect(`${HHSRS_REPORTER_PATH}/review/${row.id}`);
}

const officeUpload = multer({
  storage: multer.memoryStorage(),
  limits: hhsrsMulterLimits,
});

function uploadOfficePhotos(req: Request, res: Response, next: NextFunction): void {
  officeUpload.array("photos", HHSRS_MAX_PHOTOS)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
    flashErr(req, code === "LIMIT_FILE_SIZE" ? hhsrsPhotoSizeError() : "Could not upload photos.");
    res.redirect(`${HHSRS_REPORTER_PATH}/review`);
  });
}

function officeSendWantsJson(req: Request): boolean {
  return String(req.get("accept") || "").includes("application/json");
}

function finishOfficeSend(req: Request, res: Response, redirectTo: string): void {
  if (officeSendWantsJson(req)) {
    res.json({ ok: true, redirect: redirectTo });
    return;
  }
  res.redirect(redirectTo);
}

async function handleOfficeSend(req: Request, res: Response): Promise<void> {
  const uploaded = Array.isArray(req.files) ? req.files : [];
  const names = senderNamesFromLogin(req.user);
  const result = await createOfficeCaseAndSend({
    body: (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>,
    files: uploaded.map((file) => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    })),
    createdBy: names.sentBy || "someone",
    hasReporterAccess: Boolean(req.user && isAdmin(req.user)),
    storage: sitePhotoStorageFromApp(req.app),
    send: (row, sendBody) => deliverCaseEmail(req, row, sendBody),
  });
  if (result.ok) {
    flashOk(req, REVIEW_SENT_CONFIRMATION);
    await archiveLoggedPhotos(req, result.id);
    finishOfficeSend(req, res, `${HHSRS_REPORTER_PATH}/review/${result.id}`);
    return;
  }
  if (result.pending && result.id) {
    flashErr(req, "Not sent. The case is in Pending so you can try again.");
    finishOfficeSend(req, res, `${HHSRS_REPORTER_PATH}/review/${result.id}`);
    return;
  }
  flashErr(req, result.error);
  finishOfficeSend(req, res, `${HHSRS_REPORTER_PATH}/review`);
}

async function handleNotNeeded(req: Request, res: Response, id: string): Promise<void> {
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const result = await moveCaseToNotNeeded({
    id,
    reason: String(body.reason || ""),
    duplicateOf: String(body.duplicateOf || ""),
    note: String(body.note || ""),
    by: senderNamesFromLogin(req.user).sentBy || "someone",
  });
  if (!result.ok) {
    if (result.error === "Case not found.") {
      res.status(404).send("Case not found.");
      return;
    }
    flashErr(req, result.error);
    res.redirect(`${HHSRS_REPORTER_PATH}/review/${id}`);
    return;
  }
  flashOk(req, "Moved to Duplicates & Errors.");
  res.redirect(HHSRS_REPORTER_PATH);
}

function duplicatesHref(filters: { q?: string; project?: string; reason?: string }, openId = ""): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.project) params.set("project", filters.project);
  if (filters.reason) params.set("reason", filters.reason);
  if (openId) params.set("open", openId);
  const query = params.toString();
  return `${HHSRS_REPORTER_PATH}/duplicates${query ? `?${query}` : ""}`;
}

async function handleDuplicates(req: Request, res: Response): Promise<void> {
  const filters = {
    q: String(req.query.q || ""),
    project: String(req.query.project || ""),
    reason: String(req.query.reason || ""),
  };
  const openId = String(req.query.open || "");
  const [summary, cases, names] = await Promise.all([
    loadSummary(),
    loadDuplicates(filters, HHSRS_REPORTER_PATH),
    loadPortalProjectNames(),
  ]);
  if (filters.project && !names.some((name) => name === filters.project)) names.push(filters.project);
  const flash = takeFlash(req);
  const jsUrl =
    typeof res.locals.baseUrl === "function"
      ? res.locals.baseUrl("/js/hhsrs-duplicates.js")
      : "/js/hhsrs-duplicates.js";
  res.render("hhsrs-reporter/duplicates", {
    ...shellLocals({
      activeNav: "duplicates",
      summary,
      title: "Duplicates & Errors — HHSRS Reporter",
      flashOk: flash.ok,
      flashErr: flash.err,
    }),
    user: req.user,
    cases,
    filters,
    reasons: NOT_NEEDED_REASONS,
    projectNames: [...names].sort((a, b) => a.localeCompare(b, "en-GB")),
    openId,
    closeHref: duplicatesHref(filters),
    duplicatesJsUrl: jsUrl,
  });
}

async function handleRestore(req: Request, res: Response, id: string): Promise<void> {
  const result = await restoreCaseToPending({
    id,
    by: senderNamesFromLogin(req.user).sentBy || "someone",
  });
  if (!result.ok) {
    if (result.error === "Case not found.") {
      res.status(404).send("Case not found.");
      return;
    }
    flashErr(req, result.error);
    res.redirect(`${HHSRS_REPORTER_PATH}/duplicates`);
    return;
  }
  const label = result.reference ? `${result.reference} moved back to Pending.` : "Moved back to Pending.";
  flashOk(req, label);
  res.redirect(`${HHSRS_REPORTER_PATH}/duplicates`);
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
