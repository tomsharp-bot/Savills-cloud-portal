import { Router, type Request, type Response } from "express";
import { requireSurveyor } from "../middleware/auth.js";

export const surveyorRouter = Router();
surveyorRouter.use(requireSurveyor);

surveyorRouter.get("/", (req: Request, res: Response) => {
  res.render("surveyor", {
    title: "Home",
    user: req.user,
  });
});
