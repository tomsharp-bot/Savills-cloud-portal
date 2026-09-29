import { Router, type NextFunction, type Request, type Response } from "express";
import { canSeeDataChecks } from "../lib/access.js";
import { assembleDataChecksPage, readDataReviewPage } from "../lib/data-checks-page.js";

export const dataChecksRouter = Router();

dataChecksRouter.get("/", (req: Request, res: Response, next: NextFunction) => {
  if (!canSeeDataChecks(req.user)) {
    res.status(403).type("text/plain").send("Only Tom Sharp can open Data Checks.");
    return;
  }
  res.render(
    "partials/topbar",
    { user: req.user, canSeeDataChecks: true, dataChecksActive: true },
    (err: Error | null, topbar: string) => {
      if (err) {
        next(err);
        return;
      }
      try {
        const html = assembleDataChecksPage(readDataReviewPage(), topbar);
        res.setHeader("Cache-Control", "private, no-store");
        res.type("html").send(html);
      } catch (error) {
        next(error);
      }
    }
  );
});
