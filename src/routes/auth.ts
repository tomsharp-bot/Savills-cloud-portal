import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyPassword } from "../lib/passwords.js";

export const authRouter = Router();

authRouter.get("/login", (req, res) => {
  if (req.user) {
    res.redirect("/projects");
    return;
  }
  res.render("login", { error: "", username: "phil.m" });
});

authRouter.post("/login", async (req, res) => {
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

  req.session = req.session || {};
  req.session.userId = user.id;
  res.redirect("/projects");
});

authRouter.post("/logout", (req, res) => {
  req.session = null;
  res.redirect("/login");
});
