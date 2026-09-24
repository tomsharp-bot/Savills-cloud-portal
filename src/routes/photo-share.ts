import { Router, type Request, type Response } from "express";
import {
  findPhotoShareGrant,
  photoShareAddress,
  photoShareHelpText,
  photoShareOrigin,
  readSharedPoolImage,
} from "../lib/photo-share.js";

/**
 * Excel photo lookup. Mounted at the domain root (/photos/share), outside the portal
 * login wall. A token reads one Photos Pool image for its project. It does not start
 * a session and it does not unlock Photo Storage.
 */
export const photoShareRouter = Router();

photoShareRouter.use((_req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

function plain(res: Response, status: number, message: string): void {
  res.status(status).type("text/plain; charset=utf-8").send(message);
}

photoShareRouter.get("/:token/by-code/:code", async (req: Request, res: Response) => {
  const grant = await findPhotoShareGrant(String(req.params.token || ""));
  if (!grant.ok) {
    plain(res, grant.status, grant.error);
    return;
  }
  const image = await readSharedPoolImage(grant.projectId, String(req.params.code || ""));
  if (!image.ok) {
    plain(res, image.status, image.error);
    return;
  }
  res.status(200);
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("Content-Length", String(image.body.length));
  res.setHeader("Content-Disposition", image.disposition);
  res.end(image.body);
});

photoShareRouter.get("/:token", async (req: Request, res: Response) => {
  const secret = String(req.params.token || "");
  const grant = await findPhotoShareGrant(secret);
  if (!grant.ok) {
    plain(res, grant.status, grant.error);
    return;
  }
  const address = photoShareAddress(photoShareOrigin(req.protocol, req.get("host") || ""), secret);
  plain(res, 200, photoShareHelpText(address));
});

photoShareRouter.use((_req, res) => {
  plain(res, 401, "This photo sharing code is not valid.");
});
