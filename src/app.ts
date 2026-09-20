import path from "node:path";
import express from "express";
import cookieSession from "cookie-session";
import { config, isProduction } from "./config.js";
import { baseUrl, normalizeBasePath, prefixRedirectUrl } from "./lib/base-path.js";
import { loadUser, requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { personnelRouter } from "./routes/personnel.js";
import { stockRouter } from "./routes/stock.js";
import { loaderRouter } from "./routes/loader.js";
import { completionsRouter } from "./routes/completions.js";
import { documentsRouter } from "./routes/documents.js";
import { hhsrsSiteFormRouter } from "./routes/hhsrs-site-form.js";
import { hhsrsSubmissionsRouter } from "./routes/hhsrs-submissions.js";
import { isAdmin, roleLabel } from "./lib/access.js";
import { prisma } from "./lib/prisma.js";

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
  res.status(200).json({ ok: true, service: "savills-cloud-portal", db });
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
  const cookiePath = basePath || "/";
  const url = (href: string) => baseUrl(href, basePath);

  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", viewsDir);
  app.locals.basePath = basePath;
  app.locals.baseUrl = url;

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
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
  app.get("/hhsrs-site-form", (_req: express.Request, res: express.Response) => {
    res.redirect("/HHSRS-site-form");
  });

  if (basePath) {
    app.get("/", (_req: express.Request, res: express.Response) => {
      res.status(302).location(basePath).type("html").send(portalLandingHtml(basePath));
    });
    // Avoid Express's default 301 /projectprogress → /projectprogress/
    app.get(basePath, (req: express.Request, res: express.Response) => {
      res.redirect(req.user ? "/projects" : "/login");
    });
  }

  const portal = express.Router();
  portal.use(express.static(publicDir));
  portal.get("/health", healthHandler);
  portal.use(authRouter);
  portal.get("/", (req: express.Request, res: express.Response) => {
    res.redirect(req.user ? "/projects" : "/login");
  });

  portal.use(requireAuth);
  portal.use("/projects", projectsRouter);
  portal.use("/personnel", personnelRouter);
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
