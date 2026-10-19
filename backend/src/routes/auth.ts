import { Router } from "express";
import { requireAuth } from "@clerk/express";

export const authRouter = Router();

// Auth smoke test used by the frontend integration checks.
authRouter.get("/protected", requireAuth(), (_req, res) => {
  res.json({
    success: true,
    message: "You are authenticated!",
  });
});
