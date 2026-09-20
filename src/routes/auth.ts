import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "../lib/passwords.js";
import { reapplyAllExternalLinks } from "../lib/external.js";
import { loginBlockedForMissingAccess, NO_SITE_ACCESS_ERROR } from "../lib/login-access.js";

export const authRouter = Router();

authRouter.get("/login", (req: Request, res: Response) => {
  if (req.user) {
    res.redirect("/projects");
    return;
  }
  res.render("login", { error: "", username: "phil.m" });
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const ul = username.toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: { equals: ul, mode: "insensitive" } }, { email: { equals: ul, mode: "insensitive" } }],
    },
  });

  const ok = user && (await verifyPassword(password, user.passwordHash));
  if (!user || !ok) {
    res.status(401).render("login", { error: "Invalid username or password.", username });
    return;
  }
  if (user.role === "client" && user.frozen) {
    res.status(403).render("login", {
      error: "This client account is frozen. Contact your administrator.",
      username,
    });
    return;
  }

  if (user.role === "client" || user.role === "surveyor") {
    const accessCount = await prisma.projectAccess.count({ where: { userId: user.id } });
    if (loginBlockedForMissingAccess(user.role, accessCount)) {
      res.status(403).render("login", { error: NO_SITE_ACCESS_ERROR, username });
      return;
    }
  }

  req.session = req.session || {};
  req.session.userId = user.id;
  if (user.role === "admin") {
    try {
      await reapplyAllExternalLinks();
    } catch (err) {
      console.error("External list re-apply on login failed", err);
    }
  }
  res.redirect("/projects");
});

authRouter.post("/logout", (req: Request, res: Response) => {
  req.session = null;
  res.redirect("/login");
});
