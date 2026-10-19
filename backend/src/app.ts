import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { clerkMiddleware, requireAuth } from '@clerk/express';
import env from './config/env.js';

import healthRoutes from './routes/health.js';
import profileRoutes from './routes/profile.js';
import rideRoutes from './routes/rides.js';
import driverRoutes from './routes/drivers.js';
import mapRoutes from './routes/maps.js';
import paymentRoutes from './routes/payments.js';
import reviewRoutes from './routes/reviews.js';
import notificationRoutes from './routes/notifications.js';
import { errorHandler } from './middleware/error.js';

const app = express();

// Hosting platforms (Render, Railway, Fly) terminate TLS at a proxy in front of
// the app. Trusting the first hop lets express-rate-limit read the real client
// IP instead of throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every limited route.
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet());

const allowedOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// Razorpay webhooks need the raw body for signature verification.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

app.use(
  clerkMiddleware({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  })
);

app.use('/api', healthRoutes);
app.use('/api', profileRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/maps', mapRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api', reviewRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/protected', requireAuth(), (_req, res) => {
  res.json({ success: true, message: 'You are authenticated!' });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use(errorHandler);

export default app;
