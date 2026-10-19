import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";

/**
 * Error carrying an HTTP status and a user-facing message.
 * Thrown from handlers and rendered by the central error middleware.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly cause?: unknown;

  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.cause = options?.cause;
  }
}

/**
 * Wraps an async route handler so rejections reach the error middleware.
 * (Express 5 also forwards rejected promises; this keeps the pattern explicit.)
 */
export function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
