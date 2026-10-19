import nodemailer, { type Transporter } from 'nodemailer';
import env from '../config/env.js';

function smtpConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

let transporter: Transporter | null = null;
function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
}

export interface ReceiptData {
  to: string;
  riderName: string;
  rideId: string;
  pickup: string;
  dropoff: string;
  distanceKm: number;
  fare: number;
  paymentId?: string;
  completedAt?: string;
}

export function renderReceiptHtml(data: ReceiptData) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a">
    <h2 style="color:#0891b2">RideFlow receipt</h2>
    <p>Hi ${data.riderName || 'rider'}, thanks for riding with us.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 0;color:#64748b">Ride ID</td><td style="text-align:right">${data.rideId}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Pickup</td><td style="text-align:right">${data.pickup}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Drop-off</td><td style="text-align:right">${data.dropoff}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Distance</td><td style="text-align:right">${data.distanceKm} km</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Payment ID</td><td style="text-align:right">${data.paymentId || '-'}</td></tr>
      <tr><td style="padding:12px 0;border-top:1px solid #e2e8f0;font-weight:bold">Total</td>
          <td style="padding:12px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:bold">INR ${data.fare.toFixed(2)}</td></tr>
    </table>
    <p style="color:#64748b;font-size:12px">Completed ${data.completedAt ? new Date(data.completedAt).toLocaleString() : ''}</p>
  </div>`;
}

export async function sendReceiptEmail(data: ReceiptData) {
  if (!smtpConfigured()) {
    console.warn('SMTP not configured; skipping receipt email');
    return { sent: false, reason: 'smtp_not_configured' };
  }
  await getTransport().sendMail({
    from: env.RECEIPT_FROM_EMAIL,
    to: data.to,
    subject: `Your RideFlow receipt — ${data.rideId.slice(0, 8)}`,
    html: renderReceiptHtml(data),
  });
  return { sent: true };
}
