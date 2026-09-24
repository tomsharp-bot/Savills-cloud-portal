import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { canManageReferenceDocuments, canSeeReferenceDocuments } from "../lib/access.js";
import { prisma } from "../lib/prisma.js";
import { extOf } from "../lib/documents.js";
import {
  REF_DOC_MAX_BYTES,
  REF_DOC_MAX_FILES,
  referenceFileTooLargeMessage,
  categoryById,
  columnsWithCounts,
  contentDisposition,
  displayType,
  formatRefUpdated,
  isAllowedRefExt,
  loadReferenceFile,
  mimeForExt,
  previewKind,
  referenceDisplayName,
  ReferenceStorageError,
  referenceStorageBlockMessage,
  referenceStorageNote,
  removeReferenceFile,
  storeReferenceBytes,
} from "../lib/reference-documents.js";
import { referenceStorageMode } from "../lib/spaces.js";

export const referenceDocumentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: REF_DOC_MAX_BYTES, files: REF_DOC_MAX_FILES },
});

function queryText(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

referenceDocumentsRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (!canSeeReferenceDocuments(req.user)) {
    res.status(403).send("Not available.");
    return;
  }
  next();
});

referenceDocumentsRouter.get("/", async (req: Request, res: Response) => {
  const grouped = await prisma.referenceDocument.groupBy({
    by: ["category"],
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((row) => [row.category, row._count._all]));
  res.render("reference-documents", {
    title: "Reference Documents",
    user: req.user,
    view: "home",
    columns: columnsWithCounts(counts),
    category: null,
    documents: [],
    notice: "",
    error: "",
    storageNote: referenceStorageNote(),
  });
});

referenceDocumentsRouter.get("/:category", async (req: Request, res: Response) => {
  const category = categoryById(req.params.category);
  if (!category) {
    res.status(404).send("Category not found.");
    return;
  }
  const rows = await prisma.referenceDocument.findMany({
    where: { category: category.id },
    orderBy: { uploadedAt: "desc" },
  });
  res.render("reference-documents", {
    title: `${category.title} — Reference Documents`,
    user: req.user,
    view: "category",
    columns: [],
    category,
    documents: rows.map((row) => ({
      id: row.id,
      name: row.name,
      typeLabel: displayType(row.type),
      updated: formatRefUpdated(row.uploadedAt),
      preview: previewKind(row.type),
    })),
    notice: queryText(req.query.notice),
    error: queryText(req.query.error),
    storageNote: referenceStorageNote(),
  });
});

function acceptUpload(req: Request, res: Response, next: NextFunction): void {
  upload.array("files", REF_DOC_MAX_FILES)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
    const category = categoryById(String(req.params.category || ""));
    const back = category ? `/reference-documents/${category.id}` : "/reference-documents";
    if (code === "LIMIT_FILE_SIZE") {
      res.redirect(`${back}?error=` + encodeURIComponent(referenceFileTooLargeMessage()));
      return;
    }
    if (code === "LIMIT_FILE_COUNT" || code === "LIMIT_UNEXPECTED_FILE") {
      res.redirect(
        `${back}?error=` + encodeURIComponent(`You can upload up to ${REF_DOC_MAX_FILES} files at a time.`)
      );
      return;
    }
    next(err);
  });
}

referenceDocumentsRouter.post("/:category", (req: Request, res: Response, next: NextFunction) => {
  if (!categoryById(String(req.params.category || ""))) {
    res.status(404).send("Category not found.");
    return;
  }
  if (!canManageReferenceDocuments(req.user)) {
    res.status(403).send("Admin only.");
    return;
  }
  next();
}, acceptUpload, async (req: Request, res: Response) => {
  const user = req.user!;
  const category = categoryById(req.params.category);
  if (!category) {
    res.status(404).send("Category not found.");
    return;
  }
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  if (!files.length) {
    res.redirect(
      `/reference-documents/${category.id}?error=` + encodeURIComponent("Choose a file first.")
    );
    return;
  }
  if (referenceStorageMode() === "blocked") {
    res.redirect(
      `/reference-documents/${category.id}?error=` + encodeURIComponent(referenceStorageBlockMessage())
    );
    return;
  }

  const saved: string[] = [];
  const skipped: string[] = [];
  const storageFailures: string[] = [];
  for (const file of files) {
    const ext = extOf(file.originalname);
    const label = referenceDisplayName(file.originalname, ext || "file");
    if (!isAllowedRefExt(ext)) {
      skipped.push(label);
      continue;
    }
    const storedName = `${randomUUID()}.${ext}`;
    let stored: { spacesKey: string } | null = null;
    try {
      stored = await storeReferenceBytes({
        category: category.id,
        storedName,
        buffer: file.buffer,
        contentType: mimeForExt(ext),
      });
      await prisma.referenceDocument.create({
        data: {
          category: category.id,
          name: referenceDisplayName(file.originalname, ext),
          storedName,
          type: ext,
          size: file.size,
          uploadedBy: user.name,
          spacesKey: stored.spacesKey,
        },
      });
      saved.push(referenceDisplayName(file.originalname, ext));
    } catch (err) {
      console.error(err);
      if (stored) {
        await removeReferenceFile({ storedName, spacesKey: stored.spacesKey });
      }
      if (err instanceof ReferenceStorageError) storageFailures.push(err.message);
      else skipped.push(label);
    }
  }

  if (!saved.length) {
    const why =
      storageFailures[0] ||
      (skipped.length
        ? "Use PDF, Word, Excel, or an image (PNG or JPEG)."
        : "Could not save that file.");
    res.redirect(`/reference-documents/${category.id}?error=` + encodeURIComponent(why));
    return;
  }

  let notice = saved.length === 1 ? `Uploaded ${saved[0]}` : `Uploaded ${saved.length} files.`;
  if (skipped.length) {
    notice += ` Skipped ${skipped.join(", ")} (use PDF, Word, Excel, or an image).`;
  }
  if (storageFailures.length) {
    notice += ` ${storageFailures[0]}`;
  }
  res.redirect(`/reference-documents/${category.id}?notice=` + encodeURIComponent(notice));
});

referenceDocumentsRouter.get("/:category/:docId/:action", async (req: Request, res: Response) => {
  const category = categoryById(req.params.category);
  if (!category) {
    res.status(404).send("Category not found.");
    return;
  }
  const action = req.params.action === "download" ? "download" : req.params.action === "view" ? "view" : "";
  if (!action) {
    res.status(404).send("Not found.");
    return;
  }
  const doc = await prisma.referenceDocument.findFirst({
    where: { id: req.params.docId, category: category.id },
  });
  if (!doc) {
    res.status(404).send("Document not found.");
    return;
  }
  const loaded = await loadReferenceFile(doc);
  if (!loaded) {
    res.status(404).send("File missing.");
    return;
  }
  res.setHeader("Content-Type", mimeForExt(doc.type));
  res.setHeader("Content-Disposition", contentDisposition(action, doc.name));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  if (loaded.kind === "bytes") {
    res.setHeader("Content-Length", String(loaded.buffer.length));
    res.send(loaded.buffer);
    return;
  }
  if (referenceStorageMode() !== "disk") {
    res.status(404).send("File missing.");
    return;
  }
  res.sendFile(loaded.path, (err?: Error) => {
    if (err && !res.headersSent) res.status(404).send("File missing.");
  });
});

referenceDocumentsRouter.post("/:category/:docId/delete", async (req: Request, res: Response) => {
  const user = req.user!;
  const category = categoryById(req.params.category);
  if (!category) {
    res.status(404).send("Category not found.");
    return;
  }
  if (!canManageReferenceDocuments(user)) {
    res.status(403).send("Admin only.");
    return;
  }
  const doc = await prisma.referenceDocument.findFirst({
    where: { id: req.params.docId, category: category.id },
  });
  if (!doc) {
    res.status(404).send("Document not found.");
    return;
  }
  const removed = await removeReferenceFile(doc);
  if (!removed) {
    res.redirect(
      `/reference-documents/${category.id}?error=` +
        encodeURIComponent("Could not delete that file from Spaces. Try again.")
    );
    return;
  }
  await prisma.referenceDocument.delete({ where: { id: doc.id } });
  res.redirect(
    `/reference-documents/${category.id}?notice=` + encodeURIComponent(`Deleted ${doc.name}.`)
  );
});
