import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  PHOTO_INGEST_MAX_BYTES,
  PHOTO_INGEST_MAX_FILES,
  ingestProjectPhotos,
  listProjectPhotoNames,
  photoIngestAuthorized,
  photoIngestConfigured,
  photoIngestKeyFrom,
  resolveIngestProject,
  type IngestFile,
} from "../lib/photo-ingest.js";
import { defaultPhotoStorageOps, type PhotoStorageOps } from "../lib/photos.js";

/**
 * Morning photo import. Mounted at the domain root (/api/projects), outside the portal
 * login wall. PHOTO_INGEST_KEY is the only credential. It does not start a session.
 */
export const photoIngestRouter = Router();

/** Tests set this to stub Spaces writes. Production leaves it unset. */
export const PHOTO_INGEST_STORAGE = "photoIngestStorage";

photoIngestRouter.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

function ingestStorage(req: Request): PhotoStorageOps {
  const custom = req.app.get(PHOTO_INGEST_STORAGE);
  if (custom && typeof custom === "object") return custom as PhotoStorageOps;
  return defaultPhotoStorageOps();
}

function requireIngestKey(req: Request, res: Response, next: NextFunction): void {
  if (!photoIngestConfigured()) {
    res.status(503).json({ error: "Photo ingest is not configured. Set PHOTO_INGEST_KEY." });
    return;
  }
  if (!photoIngestAuthorized(req.get("authorization"), photoIngestKeyFrom())) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  next();
}

photoIngestRouter.use(requireIngestKey);

const ingestOptions: multer.Options = {
  storage: multer.memoryStorage(),
  // A batch of ~20 JPEGs is about 50 MB. fileSize is per file; the morning
  // client stays near 50 MB for the whole request.
  limits: {
    fileSize: PHOTO_INGEST_MAX_BYTES,
    files: PHOTO_INGEST_MAX_FILES,
    parts: PHOTO_INGEST_MAX_FILES + 8,
  },
  // Drop a property-folder prefix if the part still has one. Busboy also
  // strips paths unless preservePath is set.
  preservePath: false,
};
// Linux curl/Python send UTF-8 filenames. The default latin1 reading would
// change any non-ASCII character. Spaces in "Front Door1" are the same either way.
(ingestOptions as multer.Options & { defParamCharset?: string }).defParamCharset = "utf8";
const ingestUpload = multer(ingestOptions);

function acceptIngestFiles(req: Request, res: Response, next: NextFunction): void {
  ingestUpload.fields([
    { name: "file", maxCount: PHOTO_INGEST_MAX_FILES },
    { name: "files", maxCount: PHOTO_INGEST_MAX_FILES },
  ])(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "LIMIT_FILE_SIZE" || code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
      res.status(413).json({
        error: `Each photo must be ${PHOTO_INGEST_MAX_BYTES / (1024 * 1024)} MB or smaller, and one request can include up to ${PHOTO_INGEST_MAX_FILES} photos.`,
      });
      return;
    }
    res.status(400).json({ error: "Could not read that upload." });
  });
}

function filesFromRequest(req: Request): IngestFile[] {
  const bag = req.files;
  if (!bag || Array.isArray(bag)) return [];
  const grouped = bag as { file?: Express.Multer.File[]; files?: Express.Multer.File[] };
  const all = [...(grouped.file || []), ...(grouped.files || [])];
  return all.slice(0, PHOTO_INGEST_MAX_FILES).map((file) => ({
    originalName: file.originalname,
    buffer: file.buffer,
    mime: file.mimetype,
  }));
}

photoIngestRouter.get("/:projectKey/photos", async (req: Request, res: Response) => {
  const resolved = await resolveIngestProject(req.params.projectKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const names = await listProjectPhotoNames(resolved.project.id);
  res.json({ names, count: names.length });
});

photoIngestRouter.post("/:projectKey/photos/ingest", acceptIngestFiles, async (req: Request, res: Response) => {
  const resolved = await resolveIngestProject(req.params.projectKey);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const files = filesFromRequest(req);
  if (!files.length) {
    res.status(400).json({ error: "Choose at least one photo." });
    return;
  }
  const ops = ingestStorage(req);
  if (!ops.configured()) {
    res.status(503).json({ error: "Photo storage is not available." });
    return;
  }
  const result = await ingestProjectPhotos(resolved.project.id, files, ops);
  res.json({ uploaded: result.uploaded, skipped: result.skipped, failed: result.failed });
});
