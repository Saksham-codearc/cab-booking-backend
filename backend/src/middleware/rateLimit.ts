import { rateLimit } from 'express-rate-limit';

export const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
export const bookingLimiter = rateLimit({ windowMs: 60*1000, max: 20 });
export const acceptLimiter = rateLimit({ windowMs: 60*1000, max: 30 });
export const paymentLimiter = rateLimit({ windowMs: 60*1000, max: 20 });
export const generalLimiter = rateLimit({ windowMs: 60*1000, max: 120 });
