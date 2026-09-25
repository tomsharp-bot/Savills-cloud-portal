import path from "node:path";
import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { formatDocDate } from "../lib/dates.js";
import { config } from "../config.js";
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
  HHSRS_REPORTER_PATH,
  HHSRS_WAITING_STATUSES,
  actionedStatusLabel,
  formatTimeAgo,
  formatWorkspaceDate,
  isHhsrsCaseStatus,
  isWaitingStatus,
  draftEmailFromReviewFields,
  emailRecipientsFromProject,
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

/** Ids already on screen when this Reporter page was rendered. Null if the lookup failed. */
hhsrsReporterRouter.use(async (req: Request, res: Response, next) => {
  res.locals.initialPendingIds = null;
  const skip =
    req.path.endsWith(".json") ||
    req.path.endsWith(".csv") ||
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
  activeNav: "pending" | "review" | "main-log" | "admin" | "project-overview";
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

function csvEscape(value: string): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
  });
});

function renderReview(
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
): void {
  const photos = reporterCasePhotos(row, HHSRS_REPORTER_PATH);
  const draft = tryDraftFromRow(row);
  const currentNames = opts.progress.filter((project) => project.stage === "current").map((project) => project.name);
  const reviewProjectValue = progressNameForCase(row.projectName, currentNames);
  const matched = matchDemoProject(reviewProjectValue) || matchDemoProject(row.projectName);
  const recipients = emailRecipientsFromProject(matched);
  const flash = takeFlash(req);
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
    const draft = draftEmailFromReviewFields(fields);
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
  renderReview(req, res, row, ctx);
});

/* ---------- Main Log ---------- */
hhsrsReporterRouter.get("/main-log", async (req: Request, res: Response) => {
  const q = String(req.query.q || "").trim();
  const project = String(req.query.project || "").trim();
  const rating = String(req.query.rating || "").trim();

  const where: {
    status: { in: string[] };
    AND?: object[];
  } = { status: { in: [...HHSRS_ACTIONED_STATUSES] } };

  const and: object[] = [];
  if (q) {
    and.push({
      OR: [
        { fullAddress: { contains: q, mode: "insensitive" } },
        { uprn: { contains: q, mode: "insensitive" } },
        { projectName: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (project) and.push({ projectName: project });
  if (rating) and.push({ rating });
  if (and.length) where.AND = and;

  const [rows, summary, projects] = await Promise.all([
    prisma.hhsrsSiteSubmission.findMany({
      where,
      orderBy: [{ emailSentAt: "desc" }, { updatedAt: "desc" }],
      take: 300,
    }),
    loadSummary(),
    prisma.hhsrsSiteSubmission.findMany({
      where: { status: { in: [...HHSRS_ACTIONED_STATUSES] } },
      distinct: ["projectName"],
      select: { projectName: true },
      orderBy: { projectName: "asc" },
    }),
  ]);
  const flash = takeFlash(req);
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
    projectNames: projects.map((p) => p.projectName),
    filters: { q, project, rating },
    ratings: Array.from(new Set([...HHSRS_RATINGS, ...HHSRS_SITE_FORM_RATINGS])),
  });
});

hhsrsReporterRouter.get("/main-log/export.csv", async (req: Request, res: Response) => {
  const rows = await prisma.hhsrsSiteSubmission.findMany({
    where: { status: { in: [...HHSRS_ACTIONED_STATUSES] } },
    orderBy: [{ emailSentAt: "desc" }, { updatedAt: "desc" }],
    take: 2000,
  });
  const header = [
    "Project",
    "Address",
    "UPRN",
    "Category",
    "Rating",
    "Actioned",
    "By",
    "Status",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    const when = row.emailSentAt || row.updatedAt;
    lines.push(
      [
        csvEscape(row.projectName),
        csvEscape(row.fullAddress),
        csvEscape(row.uprn),
        csvEscape(row.category),
        csvEscape(row.rating),
        csvEscape(formatDocDate(when)),
        csvEscape(row.emailSentBy || row.lastEditedBy || ""),
        csvEscape(actionedStatusLabel(row.status)),
      ].join(",")
    );
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="hhsrs-main-log.csv"');
  res.send(lines.join("\n"));
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

/* ---------- Admin ---------- */
hhsrsReporterRouter.get("/admin", async (req: Request, res: Response) => {
  const summary = await loadSummary();
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
  });
});

/* ---------- Case save / mark actioned (canonical under /review/:id) ---------- */
hhsrsReporterRouter.post("/review/:id", async (req: Request, res: Response) => {
  await handleSave(req, res, req.params.id);
});

hhsrsReporterRouter.post("/review/:id/mark-actioned", async (req: Request, res: Response) => {
  await handleMarkActioned(req, res, req.params.id);
});

hhsrsReporterRouter.post("/review/:id/abandon", async (req: Request, res: Response) => {
  await handleAbandon(req, res, req.params.id);
});

/* Back-compat paths from PR #20 */
hhsrsReporterRouter.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (["review", "main-log", "admin", "project-overview"].includes(id)) {
    res.status(404).send("Not found.");
    return;
  }
  res.redirect(`${HHSRS_REPORTER_PATH}/review/${id}`);
});

hhsrsReporterRouter.post("/:id", async (req: Request, res: Response) => {
  await handleSave(req, res, req.params.id);
});

hhsrsReporterRouter.post("/:id/mark-sent", async (req: Request, res: Response) => {
  await handleMarkActioned(req, res, req.params.id);
});

hhsrsReporterRouter.post("/:id/mark-actioned", async (req: Request, res: Response) => {
  await handleMarkActioned(req, res, req.params.id);
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
    renderReview(req, res, row, {
      ...ctx,
      flashErr: "Select a valid rating for this case.",
    });
    return;
  }
  if (!isHhsrsCaseStatus(update.status)) {
    renderReview(req, res, row, { ...ctx, flashErr: "Select a valid case status." });
    return;
  }
  if (
    update.callOutcome &&
    !(HHSRS_CALL_OUTCOMES as readonly string[]).includes(update.callOutcome)
  ) {
    renderReview(req, res, row, { ...ctx, flashErr: "Select a valid call outcome." });
    return;
  }

  const expected = update.expectedUpdatedAt ? new Date(update.expectedUpdatedAt) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    renderReview(req, res, row, {
      ...ctx,
      flashErr: "Missing concurrency token. Reload the case and try again.",
    });
    return;
  }
  if (row.updatedAt.getTime() !== expected.getTime()) {
    renderReview(req, res, row, {
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
    status: update.status === "new" ? "in_review" : update.status,
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
    renderReview(req, res, fresh, {
      ...(await reviewContext(fresh.id)),
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then save again.",
    });
    return;
  }

  flashOk(req, "Case saved.");
  res.redirect(`${HHSRS_REPORTER_PATH}/review/${row.id}`);
}

async function handleMarkActioned(req: Request, res: Response, id: string): Promise<void> {
  const row = await loadCase(id);
  if (!row) {
    res.status(404).send("Case not found.");
    return;
  }
  const expectedRaw = String(req.body?.expectedUpdatedAt || "").trim();
  const expected = expectedRaw ? new Date(expectedRaw) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    renderReview(req, res, row, {
      ...(await reviewContext(row.id)),
      flashErr: "Missing concurrency token. Reload the case and try again.",
    });
    return;
  }
  if (row.updatedAt.getTime() !== expected.getTime()) {
    renderReview(req, res, row, {
      ...(await reviewContext(row.id)),
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then mark actioned again.",
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
      claimedBy: "",
      claimedAt: null,
    },
  });
  if (result.count !== 1) {
    const fresh = await loadCase(row.id);
    if (!fresh) {
      res.status(404).send("Case not found.");
      return;
    }
    renderReview(req, res, fresh, {
      ...(await reviewContext(fresh.id)),
      flashErr:
        "This case was updated by someone else since you opened it. Reload to see their changes, then mark actioned again.",
    });
    return;
  }
  // The case is already on the Main Log. Copy must not undo that, and a slow or
  // failed Spaces upload must not hold the redirect open.
  await archiveLoggedPhotos(req, row.id);
  flashOk(req, "Marked as actioned. Case moved to Main Log. Attach photos in Outlook before you send.");
  res.redirect(`${HHSRS_REPORTER_PATH}/main-log`);
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
  const dest = path.resolve(process.cwd(), config.uploadDir, expected);
  res.sendFile(dest, (err?: Error) => {
    if (err && !res.headersSent) {
      res.status(404).send("File missing on disk. TODO: fetch from Spaces cloud-portal-vault.");
    }
  });
});

/* Photos under /review/:id/photos/:name */
hhsrsReporterRouter.get("/review/:id/photos/:name", async (req: Request, res: Response) => {
  req.url = `/${req.params.id}/photos/${req.params.name}`;
  // Reuse by redirecting to canonical photo URL
  res.redirect(`${HHSRS_REPORTER_PATH}/${req.params.id}/photos/${encodeURIComponent(req.params.name)}`);
});
