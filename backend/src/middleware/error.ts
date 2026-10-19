import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/http.js";

/** JSON 404 for unknown routes under the mounted path. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
};

interface MaybeHttpError {
  status?: number;
  statusCode?: number;
  message?: string;
}

/**
 * Central error middleware. Must keep all four parameters.
 * HttpError -> its status + message; other 4xx (e.g. body-parser) pass through;
 * everything else logs and returns a generic 500.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      console.error(error.message, error.cause ?? "");
    }

    res.status(error.status).json({
      success: false,
      message: error.message,
    });
    return;
  }

  const candidate = error as MaybeHttpError;
  const status = candidate.status ?? candidate.statusCode;

  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({
      success: false,
      message: candidate.message || "Bad request",
    });
    return;
  }

  console.error("Unhandled request error:", error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};
