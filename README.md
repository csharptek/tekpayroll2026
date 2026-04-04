# CSharpTek Payroll System

Internal payroll management system for CSharpTek. Built with React + TypeScript (frontend) and Node.js + Express + Prisma (backend).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + Prisma ORM |
| Database | PostgreSQL |
| Auth | Microsoft Entra ID (MSAL) + Dev bypass |
| Frontend Hosting | Vercel |
| Backend + DB | Railway |
| File Storage | Cloudflare R2 |
| Email | Resend |
| Scheduled Jobs | Railway Cron |

---

## Project Structure

```
csharptek-payroll/
├── frontend/          # React app → deploys to Vercel
│   ├── src/
│   │   ├── pages/     # All 29 screens
│   │   ├── components/# Reusable UI components
│   │   ├── services/  # API client
│   │   ├── store/     # Zustand auth store
│   │   └── layouts/   # App shell
│   └── vercel.json
├── backend/           # Express API → deploys to Railway
│   ├── src/
│   │   ├── routes/    # All API endpoints
│   │   ├── services/  # Payroll engine
│   │   └── middleware/# Auth, audit, error handling
│   ├── prisma/
│   │   └── schema.prisma
│   └── railway.json
└── .github/
    └── workflows/ci.yml
```

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL (local or Railway dev DB)
- Git

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_ORG/csharptek-payroll.git
cd csharptek-payroll
```

### 2. Backend setup

```bash
cd backend
cp .env.example .env
# Edit .env — set DATABASE_URL to your local PostgreSQL
npm install
npm run db:generate
npm run db:migrate
npm run db:seed       # Seeds dummy employees and PT slabs
npm run dev           # Starts on port 4000
```

### 3. Frontend setup

```bash
cd frontend
cp .env.example .env
# Edit .env — set VITE_DEV_AUTH_BYPASS=true for local dev
npm install
npm run dev           # Starts on port 5173
```

### 4. Open the app

Visit `http://localhost:5173` — click any role card to log in.

> **Dev bypass is active** — no Microsoft 365 credentials needed during development.

---

## Deployment

### Backend → Railway

1. Create a new project on [railway.app](https://railway.app)
2. Add a **PostgreSQL** service to the project
3. Add a **New Service** → connect this GitHub repo → set root directory to `backend/`
4. Set environment variables (see below)
5. Railway auto-deploys on every push to `main`

**Required Railway environment variables:**

```
DATABASE_URL          = (auto-set by Railway PostgreSQL addon)
PORT                  = 4000
NODE_ENV              = production
FRONTEND_URL          = https://your-app.vercel.app
AZURE_TENANT_ID       = (from Entra ID App Registration)
AZURE_CLIENT_ID       = (from Entra ID App Registration)
AZURE_CLIENT_SECRET   = (from Entra ID App Registration)
R2_ACCOUNT_ID         = (from Cloudflare)
R2_ACCESS_KEY_ID      = (from Cloudflare)
R2_SECRET_ACCESS_KEY  = (from Cloudflare)
R2_BUCKET_NAME        = csharptek-payslips
R2_PUBLIC_URL         = (your R2 public bucket URL)
RESEND_API_KEY        = (from Resend)
EMAIL_FROM            = payroll@csharptek.com
DEV_AUTH_BYPASS       = false
```

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import this GitHub repo → set **Root Directory** to `frontend/`
3. Vercel auto-detects Vite — no build config needed
4. Set environment variables:

```
VITE_API_URL              = https://your-backend.railway.app
VITE_AZURE_CLIENT_ID      = (from Entra ID App Registration)
VITE_AZURE_TENANT_ID      = (from Entra ID App Registration)
VITE_AZURE_REDIRECT_URI   = https://your-app.vercel.app/auth/callback
VITE_DEV_AUTH_BYPASS      = false
```

---

## Microsoft Entra ID Setup

1. Go to [portal.azure.com](https://portal.azure.com) → Azure Active Directory → App Registrations
2. New registration → Name: `CSharpTek Payroll`
3. Redirect URI: `https://your-app.vercel.app/auth/callback`
4. Add API Permissions (Application type):
   - `User.Read.All`
   - `Directory.Read.All`
5. Create App Roles:
   - `Payroll.SuperAdmin`
   - `Payroll.HR`
   - `Payroll.Management`
   - `Payroll.Employee`
6. Assign roles to users via **Enterprise Applications → CSharpTek Payroll → Users and Groups**

---

## Railway Cron Jobs

Set these up in your Railway project after backend is deployed:

| Schedule | Command | Purpose |
|---|---|---|
| `0 0 27 * *` | `curl -X POST $API_URL/api/payroll/cron/run` | Auto-run payroll on 27th |
| `0 6 5 * *` | `curl -X POST $API_URL/api/payslips/cron/generate` | Auto-generate payslips on 5th |
| `0 2 * * *` | `curl -X POST $API_URL/api/sync/cron/delta` | Daily Entra ID delta sync |

---

## Inputs Needed Before Go-Live

- [ ] Azure Tenant ID + Client ID + Client Secret
- [ ] Cloudflare R2 bucket credentials
- [ ] Resend API key + verified sending domain
- [ ] Professional Tax slabs for your state(s)
- [ ] Company logo PNG for payslip header
- [ ] Employee Excel sheet for bulk import on day one

---

## Development Notes

- All monetary amounts stored as `Decimal` in PostgreSQL — no floating point errors
- Payroll engine is fully unit-testable — pure functions in `backend/src/services/payrollEngine.ts`
- Dev auth bypass disabled automatically in production (`DEV_AUTH_BYPASS=false`)
- Audit log captures every payroll action — cannot be deleted

---

## Modules Roadmap

- [x] **Phase 1** — Core payroll engine + employee management
- [x] **Phase 2** — Auth, payslips, loans, F&F
- [x] **Phase 3** — Reports, config, bulk import
- [ ] **Leave Management** — planned post go-live
