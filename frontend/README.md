# Campus Attendance Web App

A clean, minimal Next.js application for teachers to mark student attendance. Designed for mobile-first use on iOS Safari and Android Chrome.

## Features
- 🔐 Secure Login (JWT)
- 📊 Teacher Dashboard (Class/Subject Selection)
- 📝 Student List (Quick toggles, Mark All buttons)
- 📱 PWA Ready (Add to Home Screen)
- ⚡ Fast Performance (Next.js App Router)

## Tech Stack
- **Frontend**: Next.js 15
- **Styling**: Tailwind CSS
- **Backend**: REST API (Railway)

## Getting Started

### 1. Prerequisites
- [Bun](https://bun.sh) (recommended) or Node.js

### 2. Setup Environment
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Update `NEXT_PUBLIC_API_URL` with your Railway backend URL:
```env
NEXT_PUBLIC_API_URL=https://markhins-digital-production.up.railway.app
```

### 3. Install Dependencies
```bash
bun install
```

### 4. Run Development Server
```bash
bun dev
```

> **Note**: If you change `.env.local`, you MUST restart the development server (Ctrl+C and run `bun dev` again).

## Deployment to Vercel

1. **Push to GitHub**: Create a new repository and push this code.
2. **Connect to Vercel**: 
   - Go to [Vercel](https://vercel.com) and click "Add New Project".
   - Select your repository.
3. **Configure Settings**:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend` (if you are deploying from a subfolder)
   - **Environment Variables**: Add `NEXT_PUBLIC_API_URL`.
4. **Deploy**: Click "Deploy".

## PWA Support
To enable the full PWA experience (icons):
1. Replace `/public/icon-192.png` and `/public/icon-512.png` with your school's logo.
2. The app already includes `manifest.js` and meta tags for iOS Safari compatibility.
