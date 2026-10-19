# 🚕 RideFlow — Backend API

The backend API for **RideFlow**, a cab booking platform built with Node.js, Express, TypeScript, and Supabase PostgreSQL. It provides API endpoints and server-side services for authentication, ride management, fare estimation, and integrations.

## 🌐 Live Demo

**Frontend:** [https://cab-booking-frontend-five.vercel.app/](https://cab-booking-frontend-five.vercel.app/)

**Backend API:** [https://cab-booking-backend-s2k1.onrender.com](https://cab-booking-backend-s2k1.onrender.com)

## ✨ Features

- 🔐 Authentication and protected routes using Clerk
- 🚘 Ride booking and ride management
- 💰 Fare estimation services
- 👨‍✈️ Driver-related API functionality
- 📍 Google Maps integration
- 💳 Payment integration structure using Razorpay
- 🔔 Notification and ride status services
- 🗄️ Supabase PostgreSQL integration

*Feature availability depends on the configuration of the corresponding external services.*

## 🛠️ Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** Supabase PostgreSQL
- **Authentication:** Clerk
- **Maps:** Google Maps APIs
- **Payments:** Razorpay
- **Deployment:** Render

## ⚙️ Run Locally

### Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- Clerk credentials

### 1. Clone the repository

```bash
git clone https://github.com/Saksham-codearc/cab-booking-backend.git
cd cab-booking-backend/backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the `backend` directory, using `.env.example` as a reference.

Configure the required variables:

- `NODE_ENV`
- `PORT`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGIN`
- `FRONTEND_URL`

Optional integrations such as Google Maps server services, Razorpay, and SMTP require their corresponding credentials.

**Never commit `.env` files, service-role keys, secret keys, or database passwords.**

### 4. Start the development server

```bash
npm run dev
```

### 5. Build and run for production

```bash
npm run build
npm start
```

## 🔗 Related Repository

Frontend: [cab-booking-frontend](https://github.com/Saksham-codearc/cab-booking-frontend)

## 👨‍💻 Developer

**Saksham Rana**
