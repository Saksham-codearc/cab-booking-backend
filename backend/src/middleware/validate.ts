import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { firstIssueMessage } from "../lib/validation.js";

/**
 * Validates `req.body` against a zod schema.
 * On success the parsed (and normalized) value replaces `req.body`.
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: firstIssueMessage(result.error),
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

/** Validates `req.query` against a zod schema; on success replaces `req.query`. */
export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: firstIssueMessage(result.error),
      });
      return;
    }

    req.query = result.data as typeof req.query;
    next();
  };
}

/** Validates route params against a zod schema; on success replaces `req.params`. */
export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: firstIssueMessage(result.error),
      });
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
}
