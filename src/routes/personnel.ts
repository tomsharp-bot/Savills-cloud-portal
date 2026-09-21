import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { issueTempPassword } from "../lib/passwords.js";
import { uniqueInitials } from "../lib/initials.js";
import { requireAdmin } from "../middleware/auth.js";

export const personnelRouter = Router();
personnelRouter.use(requireAdmin);

personnelRouter.get("/", async (req: Request, res: Response) => {
  const [surveyors, clients, admins, projects] = await Promise.all([
    prisma.user.findMany({
      where: { role: "surveyor" },
      include: { access: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "client" },
      include: { access: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({ where: { role: "admin" }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ orderBy: { name: "asc" } }),
  ]);
  res.render("personnel", {
    title: "Personnel",
    user: req.user,
    surveyors,
    clients,
    admins,
    projects,
    notice: req.query.notice || "",
    error: req.query.error || "",
  });
});

async function usernameTaken(username: string, exceptId?: string): Promise<boolean> {
  const ul = username.toLowerCase();
  const hit = await prisma.user.findFirst({
    where: {
      OR: [{ username: { equals: ul, mode: "insensitive" } }, { email: { equals: ul, mode: "insensitive" } }],
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
  });
  return !!hit;
}

personnelRouter.post("/surveyors", async (req: Request, res: Response) => {
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim();
  const agency = String(req.body.agency || "").trim();
  if (!name || !username) {
    res.redirect("/personnel?error=" + encodeURIComponent("Enter a name and username."));
    return;
  }
  if (await usernameTaken(username)) {
    res.redirect("/personnel?error=" + encodeURIComponent("That username is already taken."));
    return;
  }
  const existing = await prisma.user.findMany({ where: { role: "surveyor" }, select: { initials: true } });
  const initials = uniqueInitials(
    name,
    existing.map((s) => s.initials || "")
  );
  const { plain: pw, hash } = await issueTempPassword();
  await prisma.user.create({
    data: {
      username,
      name,
      role: "surveyor",
      agency,
      initials,
      passwordHash: hash,
      lastTempPassword: pw,
    },
  });
  res.redirect("/personnel?notice=" + encodeURIComponent(`Added ${name} as ${initials} · temp password ${pw}.`));
});

personnelRouter.post("/clients", async (req: Request, res: Response) => {
  const company = String(req.body.company || "").trim();
  const person = String(req.body.person || "").trim();
  const clientRole = String(req.body.clientRole || "Client Contact");
  const username = String(req.body.username || "").trim();
  if (!person || !username) {
    res.redirect("/personnel?error=" + encodeURIComponent("Enter a person and username."));
    return;
  }
  if (await usernameTaken(username)) {
    res.redirect("/personnel?error=" + encodeURIComponent("That username is already taken."));
    return;
  }
  const { plain: pw, hash } = await issueTempPassword();
  await prisma.user.create({
    data: {
      username,
      name: person,
      role: "client",
      company,
      clientRole,
      passwordHash: hash,
      lastTempPassword: pw,
    },
  });
  res.redirect("/personnel?notice=" + encodeURIComponent(`Added client ${person} · temp password ${pw}.`));
});

personnelRouter.post("/admins", async (req: Request, res: Response) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim();
  if (!name || !email) {
    res.redirect("/personnel?error=" + encodeURIComponent("Enter a name and email."));
    return;
  }
  const username = email.split("@")[0] || email;
  if (await usernameTaken(username) || await usernameTaken(email)) {
    res.redirect("/personnel?error=" + encodeURIComponent("That email / username is already taken."));
    return;
  }
  const { plain: pw, hash } = await issueTempPassword();
  await prisma.user.create({
    data: {
      username,
      email,
      name,
      role: "admin",
      passwordHash: hash,
      lastTempPassword: pw,
    },
  });
  res.redirect("/personnel?notice=" + encodeURIComponent(`Added admin ${name} · temp password ${pw}.`));
});

personnelRouter.post("/:id/access", async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.role === "admin") {
    res.redirect("/personnel?error=" + encodeURIComponent("Cannot set project ticks for this account."));
    return;
  }
  const projectId = String(req.body.projectId || "");
  const granted = req.body.granted === "true" || req.body.granted === "on" || req.body.granted === true;
  if (granted) {
    await prisma.projectAccess.upsert({
      where: { userId_projectId: { userId: user.id, projectId } },
      update: {},
      create: { userId: user.id, projectId },
    });
  } else {
    await prisma.projectAccess.deleteMany({ where: { userId: user.id, projectId } });
  }
  if (req.accepts("json") && req.headers["x-requested-with"] === "fetch") {
    res.json({ ok: true });
    return;
  }
  res.redirect("/personnel");
});

personnelRouter.post("/:id/initials", async (req: Request, res: Response) => {
  const val = String(req.body.initials || "")
    .trim()
    .toUpperCase();
  const clash = await prisma.user.findFirst({
    where: { role: "surveyor", initials: val, NOT: { id: req.params.id } },
  });
  if (clash) {
    res.status(400).json({ error: "Those initials are already used. Try a longer form (e.g. PM and PMo)." });
    return;
  }
  await prisma.user.update({ where: { id: req.params.id }, data: { initials: val } });
  res.json({ ok: true, initials: val });
});

personnelRouter.post("/:id/agency", async (req: Request, res: Response) => {
  await prisma.user.update({
    where: { id: req.params.id },
    data: { agency: String(req.body.agency || "").trim() },
  });
  res.json({ ok: true });
});

personnelRouter.post("/:id/freeze", async (req: Request, res: Response) => {
  const frozen = req.body.frozen === "true" || req.body.frozen === "on" || req.body.frozen === true;
  await prisma.user.update({ where: { id: req.params.id }, data: { frozen } });
  res.json({ ok: true, frozen });
});

personnelRouter.post("/:id/reset-password", async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) {
    res.redirect("/personnel?error=" + encodeURIComponent("Account not found."));
    return;
  }
  const { plain: pw, hash } = await issueTempPassword();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hash, lastTempPassword: pw },
  });
  res.redirect(
    "/personnel?notice=" +
      encodeURIComponent(`Reset temporary password for ${user.name}: ${pw} — copy it now. It stays listed here until they set their own password.`)
  );
});

personnelRouter.post("/:id/delete", async (req: Request, res: Response) => {
  if (req.user?.id === req.params.id) {
    res.redirect("/personnel?error=" + encodeURIComponent("You cannot remove the account you are logged in as."));
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) {
    res.redirect("/personnel?error=" + encodeURIComponent("Account not found."));
    return;
  }
  await prisma.user.delete({ where: { id: user.id } });
  res.redirect("/personnel?notice=" + encodeURIComponent("Removed " + user.name));
});
