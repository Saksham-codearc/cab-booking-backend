import { Router } from "express";
import { apiLimiter } from "../middleware/rateLimit.js";
import { authRouter } from "./auth.js";
import { healthRouter } from "./health.js";
import { profileRouter } from "./profile.js";
import { ridesRouter } from "./rides.js";

/**
 * All `/api/*` routes. Mounted as `app.use("/api", apiLimiter, apiRouter)`.
 * New feature routers (drivers, maps, payments, ...) plug in here.
 */
export const apiRouter = Router();

apiRouter.use(apiLimiter);
apiRouter.use(healthRouter);
apiRouter.use(authRouter);
apiRouter.use(profileRouter);
apiRouter.use(ridesRouter);
