import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/auth.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get("/", (req: Request, res: Response) => {
  res.render("admin", {
    title: "Admin",
    user: req.user,
  });
});
