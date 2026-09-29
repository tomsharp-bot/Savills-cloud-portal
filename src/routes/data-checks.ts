import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { canSeeDataChecks } from "../lib/access.js";
import { assembleDataChecksPage, readDataReviewPage, type DataChecksBoot } from "../lib/data-checks-page.js";
import { baseUrl } from "../lib/base-path.js";
import { config } from "../config.js";
import {
  MASTER_DATA_MAX_BYTES,
  MASTER_DATA_MIME,
  archiveLiveMaster,
  findMasterRecord,
  listLiveMasterDataFiles,
  masterContentDisposition,
  masterStoredPath,
  readLiveMaster,
  storeMasterDataFile,
} from "../lib/master-data-files.js";

export const dataChecksRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MASTER_DATA_MAX_BYTES },
});

function tomOnly(req: Request, res: Response): boolean {
  if (!canSeeDataChecks(req.user)) {
    res.status(403).type("text/plain").send("Only Tom Sharp can open Data Checks.");
    return false;
  }
  return true;
}

function portalUrl(res: Response, href: string): string {
  const prefix = typeof res.locals.basePath === "string" ? res.locals.basePath : config.basePath;
  const fromLocals = res.locals.baseUrl;
  if (typeof fromLocals === "function") return fromLocals(href);
  return baseUrl(href, prefix);
}

function queryText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

dataChecksRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  if (!tomOnly(req, res)) return;
  try {
    const files = await listLiveMasterDataFiles();
    res.locals.dataChecksActive = true;
    res.setHeader("Cache-Control", "private, no-store");
    res.render("data-checks/index", {
      user: req.user,
      files,
      notice: queryText(req.query.notice),
      error: queryText(req.query.error),
    });
  } catch (error) {
    next(error);
  }
});

dataChecksRouter.get("/files/:id/download", async (req: Request, res: Response, next: NextFunction) => {
  if (!tomOnly(req, res)) return;
  try {
    const stored = await findMasterRecord(req.params.id);
    if (!stored) {
      res.status(404).type("text/plain").send("That file is not stored.");
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", MASTER_DATA_MIME);
    res.setHeader("Content-Disposition", masterContentDisposition(stored.name));
    res.sendFile(masterStoredPath(stored.storedName), (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (error) {
    next(error);
  }
});

dataChecksRouter.get("/files/:id", async (req: Request, res: Response, next: NextFunction) => {
  if (!tomOnly(req, res)) return;
  try {
    const live = await readLiveMaster(req.params.id);
    if (!live) {
      res.status(404).type("text/plain").send("That live file is not on the list.");
      return;
    }
    const listUrl = portalUrl(res, "/data-checks");
    const boot: DataChecksBoot = {
      fileId: live.id,
      fileName: live.name,
      fileUrl: portalUrl(res, `/data-checks/files/${live.id}/download`),
      saveUrl: portalUrl(res, `/data-checks/files/${live.id}/save`),
      listUrl,
    };
    res.render(
      "partials/topbar",
      { user: req.user, canSeeDataChecks: true, dataChecksActive: true },
      (err: Error | null, topbar: string) => {
        if (err) {
          next(err);
          return;
        }
        try {
          const html = assembleDataChecksPage(readDataReviewPage(), topbar, { backHref: listUrl, boot });
          res.setHeader("Cache-Control", "private, no-store");
          res.type("html").send(html);
        } catch (error) {
          next(error);
        }
      }
    );
  } catch (error) {
    next(error);
  }
});

dataChecksRouter.post("/files/:id/archive", async (req: Request, res: Response, next: NextFunction) => {
  if (!tomOnly(req, res)) return;
  try {
    const result = await archiveLiveMaster(req.params.id);
    if (!result.ok) {
      res.status(result.status).type("text/plain").send(result.message);
      return;
    }
    const notice = `Archived ${result.name}. It is off the live list. The file and its validations are kept.`;
    res.redirect("/data-checks?notice=" + encodeURIComponent(notice));
  } catch (error) {
    next(error);
  }
});

function acceptUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(413).type("text/plain").send("That master file is too large to store.");
      return;
    }
    next();
  });
}

dataChecksRouter.post("/files/:id/save", acceptUpload, async (req: Request, res: Response, next: NextFunction) => {
  if (!tomOnly(req, res)) return;
  try {
    if (!req.file) {
      res.status(400).type("text/plain").send("Choose the master file first.");
      return;
    }
    const result = await storeMasterDataFile({
      bytes: req.file.buffer,
      fileName: req.file.originalname,
      replaceId: req.params.id,
      asNew: req.body?.asNew === "1" || req.body?.asNew === "true",
    });
    if (!result.ok) {
      res.status(result.status).type("text/plain").send(result.message);
      return;
    }
    res.json({
      id: result.id,
      name: result.name,
      openUrl: portalUrl(res, `/data-checks/files/${result.id}`),
    });
  } catch (error) {
    next(error);
  }
});
