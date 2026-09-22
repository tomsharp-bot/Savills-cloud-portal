import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { isAdmin, isSurveyor, type AuthedUser } from "../lib/access.js";
import { baseUrl } from "../lib/base-path.js";
import { config } from "../config.js";

function loginPath(res: Response): string {
  const prefix = typeof res.locals.basePath === "string" ? res.locals.basePath : config.basePath;
  return baseUrl("/login", prefix);
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
  }
}

export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    req.user = undefined;
    return next();
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      role: true,
      name: true,
      email: true,
      initials: true,
      agency: true,
      company: true,
      clientRole: true,
      frozen: true,
    },
  });
  if (!user || user.frozen) {
    if (req.session) req.session.userId = undefined;
    req.user = undefined;
    return next();
  }
  req.user = user;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    if (req.accepts("html") && !req.path.startsWith("/api")) {
      res.redirect(loginPath(res));
      return;
    }
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.redirect(loginPath(res));
    return;
  }
  if (!isAdmin(req.user)) {
    res.status(403).send("Admin only.");
    return;
  }
  next();
}

export function requireSurveyor(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.redirect(loginPath(res));
    return;
  }
  if (!isSurveyor(req.user)) {
    res.status(403).send("Surveyor only.");
    return;
  }
  next();
}

export async function userAccessIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.projectAccess.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return new Set(rows.map((r) => r.projectId));
}
