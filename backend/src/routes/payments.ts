import { Router } from 'express';
import { requireAuth } from '@clerk/express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { asyncHandler } from '../lib/http.js';
import { requireProfile, AuthedRequest } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { paymentLimiter } from '../middleware/rateLimit.js';
import {
  getRazorpay,
  razorpayConfigured,
  toPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../services/payments.js';
import { notifyRide, notifyProfile } from '../services/realtime.js';
import { createNotification } from '../services/notifications.js';
import env from '../config/env.js';

const router = Router();

const verifySchema = z.object({
  rideId: z.string().uuid(),
  razorpay_order_id: z.string().min(3),
  razorpay_payment_id: z.string().min(3),
  razorpay_signature: z.string().min(3),
});

// Called by the frontend immediately after Razorpay Checkout succeeds.
router.post(
  '/verify',
  requireAuth(),
  requireProfile,
  paymentLimiter,
  validateBody(verifySchema),
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    const body = req.body as z.infer<typeof verifySchema>;

    const { data: ride } = await supabase.from('rides').select('*').eq('id', body.rideId).maybeSingle();
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (ride.rider_id !== profile.id) return res.status(403).json({ success: false, message: 'This ride is not yours' });

    let valid = false;
    try {
      valid = verifyCheckoutSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature);
    } catch {
      valid = false;
    }
    if (!valid) return res.status(400).json({ success: false, message: 'Invalid payment signature' });

    const { data: payment, error } = await supabase
      .from('payments')
      .update({
        razorpay_payment_id: body.razorpay_payment_id,
        razorpay_signature: body.razorpay_signature,
        status: 'authorized',
        updated_at: new Date().toISOString(),
      })
      .eq('ride_id', body.rideId)
      .eq('razorpay_order_id', body.razorpay_order_id)
      .select('*')
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, message: 'Could not save payment' });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment order not found for this ride' });

    await supabase.from('rides').update({ payment_status: 'authorized' }).eq('id', ride.id);
    await notifyProfile(ride.rider_id, 'payment:authorized', { rideId: ride.id, payment });
    await notifyRide(ride.id, 'payment:authorized', { rideId: ride.id, payment });

    return res.status(200).json({ success: true, message: 'Payment authorized', payment });
  })
);

// Retry/order endpoint (useful if the initial order creation failed).
router.post(
  '/order/:rideId',
  requireAuth(),
  requireProfile,
  paymentLimiter,
  asyncHandler(async (req, res) => {
    const profile = (req as AuthedRequest).profile;
    if (!razorpayConfigured()) return res.status(503).json({ success: false, message: 'Razorpay is not configured' });

    const { data: ride } = await supabase.from('rides').select('*').eq('id', req.params.rideId).maybeSingle();
    if (!ride) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (ride.rider_id !== profile.id) return res.status(403).json({ success: false, message: 'This ride is not yours' });
    if (ride.payment_status === 'paid') return res.status(409).json({ success: false, message: 'Ride is already paid' });

    const amount = Number(ride.final_fare ?? ride.estimated_fare) || 0;
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Ride has no payable fare' });

    const order = await getRazorpay().orders.create({
      amount: toPaise(amount),
      currency: 'INR',
      receipt: `ride_${ride.id}`.slice(0, 40),
      notes: { rideId: ride.id, riderId: profile.id },
      payment_capture: 0,
    });

    const { data: payment, error } = await supabase
      .from('payments')
      .insert({
        ride_id: ride.id,
        razorpay_order_id: order.id,
        amount,
        currency: 'INR',
        status: 'created',
        platform_fee: ride.platform_fee,
        driver_earnings: ride.driver_earnings,
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ success: false, message: 'Could not save payment order' });

    return res.status(201).json({
      success: true,
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: env.RAZORPAY_KEY_ID,
      payment,
    });
  })
);

// Razorpay webhook. Mounted with express.raw() in index.ts, so req.body is a Buffer.
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      return res.status(503).json({ success: false, message: 'Webhook secret not configured' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    const signature = req.header('x-razorpay-signature') ?? '';
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    const entity = event?.payload?.payment?.entity;
    const refund = event?.payload?.refund?.entity;

    if (entity?.order_id) {
      const { data: payment } = await supabase
        .from('payments')
        .select('*')
        .eq('razorpay_order_id', entity.order_id)
        .maybeSingle();

      if (payment) {
        if (event.event === 'payment.authorized') {
          await supabase
            .from('payments')
            .update({ status: 'authorized', razorpay_payment_id: entity.id, method: entity.method, updated_at: new Date().toISOString() })
            .eq('id', payment.id);
          await supabase.from('rides').update({ payment_status: 'authorized' }).eq('id', payment.ride_id);
        } else if (event.event === 'payment.captured') {
          await supabase
            .from('payments')
            .update({ status: 'captured', razorpay_payment_id: entity.id, method: entity.method, captured_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', payment.id);
          await supabase.from('rides').update({ payment_status: 'paid' }).eq('id', payment.ride_id);
        } else if (event.event === 'payment.failed') {
          await supabase
            .from('payments')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('id', payment.id);
          await supabase.from('rides').update({ payment_status: 'failed' }).eq('id', payment.ride_id);
        }
      }
    }

    if (event.event === 'refund.processed' && refund?.payment_id) {
      const { data: payment } = await supabase
        .from('payments')
        .select('*')
        .eq('razorpay_payment_id', refund.payment_id)
        .maybeSingle();
      if (payment) {
        await supabase.from('payments').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('id', payment.id);
        await supabase.from('rides').update({ payment_status: 'refunded' }).eq('id', payment.ride_id);
      }
    }

    // Always 200 quickly so Razorpay does not retry a correctly verified event.
    return res.status(200).json({ success: true });
  })
);

export default router;
