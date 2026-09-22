import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/auth.js";

export const photosRouter = Router();
photosRouter.use(requireAdmin);

photosRouter.get("/", (req: Request, res: Response) => {
  res.render("photos", {
    title: "Photos",
    user: req.user,
  });
});
