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
