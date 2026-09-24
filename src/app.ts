import path from "node:path";
import express from "express";
import cookieSession from "cookie-session";
import { config, isProduction } from "./config.js";
import { baseUrl, normalizeBasePath, prefixRedirectUrl } from "./lib/base-path.js";
import { loadUser, requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from "./routes/account.js";
import { projectsRouter } from "./routes/projects.js";
import { personnelRouter } from "./routes/personnel.js";
import { stockRouter } from "./routes/stock.js";
import { loaderRouter } from "./routes/loader.js";
import { completionsRouter } from "./routes/completions.js";
import { documentsRouter } from "./routes/documents.js";
import { hhsrsSiteFormRouter } from "./routes/hhsrs-site-form.js";
import { hhsrsSubmissionsRouter } from "./routes/hhsrs-submissions.js";
import { hhsrsReporterRouter } from "./routes/hhsrs-reporter.js";
import { HHSRS_REPORTER_ALIAS, HHSRS_REPORTER_PATH } from "./lib/hhsrs-reporter.js";
import { adminRouter } from "./routes/admin.js";
import { programmeRouter } from "./routes/programme.js";
import { isAdmin, roleLabel } from "./lib/access.js";
import { postLoginPath } from "./lib/landing.js";
import { photosRouter } from "./routes/photos.js";
import { photoShareRouter } from "./routes/photo-share.js";
import { referenceDocumentsRouter } from "./routes/reference-documents.js";
import { surveyorRouter } from "./routes/surveyor.js";
import { prisma } from "./lib/prisma.js";
import { spacesHealth } from "./lib/spaces.js";

const viewsDir = path.join(process.cwd(), "views");
const publicDir = path.join(process.cwd(), "public");

export type CreateAppOptions = {
  /** Override config.basePath (used in tests). */
  basePath?: string;
};

function wrapRedirect(res: express.Response, basePath: string): void {
  const original = res.redirect.bind(res);
  res.redirect = ((arg1: string | number, arg2?: string | number) => {
    if (typeof arg1 === "number") {
      return original(arg1, prefixRedirectUrl(String(arg2 ?? "/"), basePath));
    }
    if (typeof arg2 === "number") {
      return original(arg2, prefixRedirectUrl(String(arg1), basePath));
    }
    return original(prefixRedirectUrl(String(arg1), basePath));
  }) as typeof res.redirect;
}

async function healthHandler(_req: express.Request, res: express.Response): Promise<void> {
  let db = "unknown";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }
  const spaces = spacesHealth();
  res.status(200).json({ ok: true, service: "savills-cloud-portal", db, spaces });
}

function portalLandingHtml(href: string): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <title>Savills Cloud Portal</title>
</head>
<body>
  <p><a href="${href}">Savills Cloud Portal</a></p>
</body>
</html>`;
}

export function createApp(options: CreateAppOptions = {}) {
  const basePath =
    options.basePath !== undefined ? normalizeBasePath(options.basePath) : config.basePath;
  // Root-mounted apps (/HHSRS-site-form, /HHSRSreporter) share the portal login cookie.
  const cookiePath = "/";
  const url = (href: string) => baseUrl(href, basePath);

  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", viewsDir);
  app.locals.basePath = basePath;
  app.locals.baseUrl = url;

  // JSON / urlencoded parsers skip multipart. Keep these well above form-field
  // size so they cannot 413 a request before multer's per-photo check.
  // Photo uploads (4 × 40MB) are parsed only by multer on the HHSRS route.
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(
    cookieSession({
      name: "scp_session",
      keys: [config.sessionSecret],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: cookiePath,
    })
  );
  app.use(loadUser);
  if (basePath) {
    // Drop session cookies that were previously scoped only to the portal prefix
    // so a later Path=/ login cannot leave two scp_session cookies in play.
    app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
      const expired = `Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=${basePath}; HttpOnly; SameSite=Lax`;
      res.append("Set-Cookie", `scp_session=; ${expired}`);
      res.append("Set-Cookie", `scp_session.sig=; ${expired}`);
      next();
    });
  }
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.currentUser = req.user || null;
    res.locals.roleLabel = req.user ? roleLabel(req.user.role) : "";
    res.locals.isAdmin = isAdmin(req.user);
    res.locals.isClient = req.user?.role === "client";
    res.locals.isSurveyor = req.user?.role === "surveyor";
    res.locals.basePath = basePath;
    res.locals.baseUrl = url;
    wrapRedirect(res, basePath);
    next();
  });

  // DigitalOcean health checks hit the container at /health even when the
  // public site is mounted under BASE_PATH.
  app.get("/health", healthHandler);

  // HHSRS site form is a public root app — not under /projectprogress.
  app.use("/HHSRS-site-form", hhsrsSiteFormRouter);

  // HHSRS Reporter (admin office tool) also mounts at the domain root so the
  // path stays /HHSRSreporter even when Mark Up lives under BASE_PATH.
  app.get(HHSRS_REPORTER_ALIAS, (_req: express.Request, res: express.Response) => {
    res.redirect(HHSRS_REPORTER_PATH);
  });
  app.use(HHSRS_REPORTER_ALIAS, (req: express.Request, res: express.Response) => {
    const suffix = req.url === "/" ? "" : req.url;
    res.redirect(`${HHSRS_REPORTER_PATH}${suffix}`);
  });
  app.use(HHSRS_REPORTER_PATH, hhsrsReporterRouter);

  // Excel photo sharing lives at the domain root, even when Mark Up is under BASE_PATH.
  // It is not behind portal login. The token cannot open the app UI.
  app.use("/photos/share", photoShareRouter);

  if (basePath) {
    app.get("/", (_req: express.Request, res: express.Response) => {
      res.status(302).location(basePath).type("html").send(portalLandingHtml(basePath));
    });
    // Avoid Express's default 301 /projectprogress → /projectprogress/
    app.get(basePath, (req: express.Request, res: express.Response) => {
      res.redirect(req.user ? postLoginPath(req.user.role) : "/login");
    });
  }

  const portal = express.Router();
  portal.use(express.static(publicDir));
  portal.get("/health", healthHandler);
  portal.use(authRouter);
  portal.get("/", (req: express.Request, res: express.Response) => {
    res.redirect(req.user ? postLoginPath(req.user.role) : "/login");
  });

  portal.use(requireAuth);
  portal.use("/account", accountRouter);
  portal.use("/projects", projectsRouter);
  portal.use("/admin", adminRouter);
  portal.use("/surveyor", surveyorRouter);
  portal.use("/reference-documents", referenceDocumentsRouter);
  portal.use("/projects-programme", programmeRouter);
  portal.use("/personnel", personnelRouter);
  portal.use("/photos", photosRouter);
  portal.use(stockRouter);
  portal.use(loaderRouter);
  portal.use(completionsRouter);
  portal.use(documentsRouter);
  portal.use("/hhsrs-submissions", hhsrsSubmissionsRouter);

  if (basePath) {
    app.use(basePath, portal);
  } else {
    app.use(portal);
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    const message = isProduction ? "Something went wrong." : err instanceof Error ? err.message : String(err);
    res.status(500).send(message);
  });

  return app;
}
