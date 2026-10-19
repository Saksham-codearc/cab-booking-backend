import { ZodSchema } from 'zod';
import { Request, Response, NextFunction } from 'express';

/**
 * Express 5 exposes `req.query` through a prototype getter, so plain
 * assignment throws ("Cannot set property query"). Redefine the property on
 * the request instance instead so validated values are visible downstream.
 */
function replaceRequestProperty(req: Request, key: 'query' | 'params', value: unknown) {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: result.error.flatten() });
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: result.error.flatten() });
    }
    replaceRequestProperty(req, 'query', result.data);
    next();
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: result.error.flatten() });
    }
    replaceRequestProperty(req, 'params', result.data);
    next();
  };
}
