import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import env from '../config/env.js';

export function razorpayConfigured() {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

let client: Razorpay | null = null;
export function getRazorpay(): Razorpay {
  if (!razorpayConfigured()) throw new Error('Razorpay is not configured');
  if (!client) {
    client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }
  return client;
}

export function toPaise(amount: number) {
  return Math.round(Number(amount) * 100);
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function verifyWebhookSignature(rawBody: string, signature: string) {
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
