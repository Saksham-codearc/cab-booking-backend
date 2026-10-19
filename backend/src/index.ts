import { env } from "./config/env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { clerkMiddleware } from "@clerk/express";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { apiRouter } from "./routes/index.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json({ limit: "50kb" }));
app.use(
  clerkMiddleware({
    publishableKey: env.clerkPublishableKey,
    secretKey: env.clerkSecretKey,
  })
);

app.use("/api", apiRouter);
app.use("/api", notFoundHandler);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Cab Booking API running at http://localhost:${env.port}`);
});
