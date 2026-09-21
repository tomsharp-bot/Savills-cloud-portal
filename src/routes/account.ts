import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { hashPassword, MIN_PASSWORD_LENGTH, newPasswordError, verifyPassword } from "../lib/passwords.js";

export const accountRouter = Router();

function renderChangePassword(req: Request, res: Response, error: string, notice: string, status = 200): void {
  res.status(status).render("account-password", {
    title: "Change password",
    user: req.user,
    error,
    notice,
    minLength: MIN_PASSWORD_LENGTH,
  });
}

accountRouter.get("/", (_req: Request, res: Response) => {
  res.redirect("/account/password");
});

accountRouter.get("/password", (req: Request, res: Response) => {
  renderChangePassword(req, res, String(req.query.error || ""), String(req.query.notice || ""));
});

accountRouter.post("/password", async (req: Request, res: Response) => {
  const current = String(req.body.currentPassword || "");
  const next = String(req.body.newPassword || "");
  const confirm = String(req.body.confirmPassword || "");

  if (!current) {
    renderChangePassword(req, res, "Enter your current password.", "", 400);
    return;
  }

  const mismatch = newPasswordError(next, confirm);
  if (mismatch) {
    renderChangePassword(req, res, mismatch, "", 400);
    return;
  }

  const row = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { passwordHash: true },
  });
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    renderChangePassword(req, res, "Current password is incorrect.", "", 400);
    return;
  }

  await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      passwordHash: await hashPassword(next),
      lastTempPassword: null,
    },
  });

  res.redirect("/account/password?notice=" + encodeURIComponent("Password updated."));
});
