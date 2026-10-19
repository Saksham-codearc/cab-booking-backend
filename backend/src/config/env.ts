import dotenv from 'dotenv';

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const env = {
  PORT,
  NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  CORS_ORIGIN: process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:3000',

  CLERK_PUBLISHABLE_KEY: required('CLERK_PUBLISHABLE_KEY', process.env.CLERK_PUBLISHABLE_KEY),
  CLERK_SECRET_KEY: required('CLERK_SECRET_KEY', process.env.CLERK_SECRET_KEY),

  SUPABASE_URL: required('SUPABASE_URL', process.env.SUPABASE_URL),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),

  GOOGLE_MAPS_SERVER_KEY: process.env.GOOGLE_MAPS_SERVER_KEY || '',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  PLATFORM_FEE_PERCENT: Number(process.env.PLATFORM_FEE_PERCENT) || 20,

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  RECEIPT_FROM_EMAIL: process.env.RECEIPT_FROM_EMAIL || process.env.SMTP_USER || '',
};

export default env;
export type Env = typeof env;
