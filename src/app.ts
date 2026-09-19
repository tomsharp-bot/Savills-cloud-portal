import path from "node:path";
import express from "express";
import cookieSession from "cookie-session";
import { config, isProduction } from "./config.js";
import { loadUser, requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { personnelRouter } from "./routes/personnel.js";
import { stockRouter } from "./routes/stock.js";
import { loaderRouter } from "./routes/loader.js";
import { completionsRouter } from "./routes/completions.js";
import { documentsRouter } from "./routes/documents.js";
import { isAdmin, roleLabel } from "./lib/access.js";
import { prisma } from "./lib/prisma.js";

const viewsDir = path.join(process.cwd(), "views");
const publicDir = path.join(process.cwd(), "public");

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", viewsDir);

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
    })
  );
  app.use(express.static(publicDir));
  app.use(loadUser);

  app.use((req, res, next) => {
    res.locals.currentUser = req.user || null;
    res.locals.roleLabel = req.user ? roleLabel(req.user.role) : "";
    res.locals.isAdmin = isAdmin(req.user);
    res.locals.isClient = req.user?.role === "client";
    res.locals.isSurveyor = req.user?.role === "surveyor";
    next();
  });

  app.get("/health", async (_req, res) => {
    let db = "unknown";
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = "up";
    } catch {
      db = "down";
    }
    res.status(200).json({ ok: true, service: "savills-cloud-portal", db });
  });

  app.use(authRouter);
  app.get("/", (req, res) => {
    res.redirect(req.user ? "/projects" : "/login");
  });

  app.use(requireAuth);
  app.use("/projects", projectsRouter);
  app.use("/personnel", personnelRouter);
  app.use(stockRouter);
  app.use(loaderRouter);
  app.use(completionsRouter);
  app.use(documentsRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    const message = isProduction ? "Something went wrong." : err instanceof Error ? err.message : String(err);
    res.status(500).send(message);
  });

  return app;
}
