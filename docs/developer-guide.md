# RandC Production — Developer Guide

**Last updated:** 2026-06-28  
**Stack:** Vanilla JS + HTML/CSS (Vercel) · Express.js 5 / Node.js ESM (Hostinger) · MySQL2 · Prisma 6

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Local Development Setup](#3-local-development-setup)
4. [Frontend Guide](#4-frontend-guide)
5. [Backend Guide](#5-backend-guide)
6. [Database Guide](#6-database-guide)
7. [Email Service](#7-email-service)
8. [Deployment](#8-deployment)

---

## 1. Project Overview

RandC is a document processing platform. The frontend (static) and backend (API) are deployed independently.

| Layer | Deployment | URL pattern |
|-------|------------|-------------|
| Frontend | Vercel | `https://randc.vercel.app` |
| Backend API | Hostinger Node.js | `https://YOUR-BACKEND.hostinger.app` |
| Database | MySQL on Hostinger | accessed only by backend |

The two projects live inside the same git repository under separate top-level folders:

```
randc-production/
├── frontend/   ← static HTML/CSS/JS deployed to Vercel
└── backend/    ← Express API deployed to Hostinger
```

---

## 2. Repository Layout

```
randc-production/
├── frontend/
│   ├── pages/          HTML pages (one file per route)
│   ├── js/             JavaScript files loaded by pages
│   ├── css/            Stylesheets
│   ├── images/         Static assets (logo, etc.)
│   ├── vercel.json     URL rewrite rules
│   └── package.json    (Vercel config only — no build step)
│
├── backend/
│   ├── server.js           Express app entry point
│   ├── prisma/
│   │   ├── schema.prisma   Source of truth for DB schema
│   │   └── migrations/     Auto-generated SQL migration files
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js       MySQL2 connection pool
│   │   │   ├── prisma.js   Prisma client instance
│   │   │   └── socket.js   Socket.io setup
│   │   ├── middleware/
│   │   │   └── auth.js     JWT verification + role guard
│   │   ├── model/          Raw MySQL2 query functions (one file per domain)
│   │   ├── controller/     HTTP handler functions (one file per route group)
│   │   ├── routes/         Express routers (one file per prefix)
│   │   ├── services/
│   │   │   ├── emailService.js   Gmail OAuth2 raw MIME emails
│   │   │   ├── authService.js
│   │   │   └── otpService.js
│   │   └── utils/
│   │       └── validator.js
│   ├── .env                Not committed — copy from .env.example
│   ├── .env.example        Template for required env vars
│   └── package.json
│
└── docs/
    └── superpowers/
        ├── specs/          Feature design specs
        └── plans/          Step-by-step implementation plans
```

---

## 3. Local Development Setup

### Prerequisites

- Node.js 20+
- MySQL 8.x running locally
- A Gmail account with OAuth2 credentials (for email features)

### Backend

```bash
cd backend
cp .env.example .env        # fill in your local DB creds and secrets
npm install
npm run dev                 # nodemon server.js — restarts on file change
```

The API listens on `http://localhost:3000`.

**Minimum `.env` for local development:**

```env
NODE_ENV=development
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=document_processing

JWT_SECRET=any-long-random-string-for-local-dev

APP_URL=http://localhost:5500
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

Email features (Gmail OAuth2) are optional for local dev — booking confirmation emails will simply log an error and the booking still saves.

### Frontend

The frontend is plain HTML — no build step needed. Open pages directly in a browser or use a static server:

```bash
cd frontend
npx serve .           # serves on http://localhost:3000 (or another port)
```

Or open `frontend/pages/index.html` directly in a browser using VS Code Live Server.

**Connecting to the local backend:**  
`global.js` auto-detects localhost and sets `BASE_URL = ''` (empty string), so all `fetch` calls use relative paths. No configuration needed.

---

## 4. Frontend Guide

### Tech Stack

- **HTML5 / CSS3 / Vanilla JavaScript** — no framework, no bundler
- **Bootstrap 5.3.0** — loaded via CDN in each page
- **Google Fonts** — Outfit + DM Sans (loaded per-page)
- **Deployment** — Vercel (static hosting)

### Page Routing

Routes are defined in `frontend/vercel.json` as URL rewrites:

```json
{ "source": "/",              "destination": "/pages/index.html" },
{ "source": "/admin",         "destination": "/pages/admin.html" },
{ "source": "/client",        "destination": "/pages/client.html" },
{ "source": "/booking",       "destination": "/pages/booking.html" },
{ "source": "/track/:token",  "destination": "/pages/track.html" },
{ "source": "/ticket/:token", "destination": "/pages/ticket.html" }
```

**Adding a new page:**

1. Create `frontend/pages/mypage.html`
2. Add the rewrite to `vercel.json`:
   ```json
   { "source": "/mypage", "destination": "/pages/mypage.html" }
   ```
3. Load `global.js` as the first script in the page:
   ```html
   <script src="/js/global.js"></script>
   <script src="/js/mypage.js"></script>
   ```

### global.js — BASE_URL and Auth

Every page that calls the backend must load `global.js` first. It exposes `BASE_URL` and `Logout()`.

```js
// frontend/js/global.js
const BACKEND_PROD_URL = 'https://YOUR-BACKEND.hostinger.app';

const BASE_URL = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
) ? '' : BACKEND_PROD_URL;
```

**Before deploying**, update `BACKEND_PROD_URL` to your actual Hostinger URL.

**Making API calls from a page:**

```js
// Always prefix API paths with BASE_URL
const response = await fetch(`${BASE_URL}/api/public/services`);

// Authenticated endpoints need the JWT token
const token = localStorage.getItem('token');
const response = await fetch(`${BASE_URL}/api/client/appointments`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Authentication State

The JWT token is stored in `localStorage`:

```js
localStorage.setItem('token', jwt);         // on login
localStorage.setItem('user', JSON.stringify(user));

const token = localStorage.getItem('token'); // on each request
const user  = JSON.parse(localStorage.getItem('user') || 'null');

localStorage.removeItem('token');            // on logout
localStorage.removeItem('user');
```

Pages that require login should check for a token on load and redirect to `/` if absent.

### Design System

All pages follow this token set (defined inline in each page's `<style>` block):

| Token | Value |
|-------|-------|
| Background | `#080d17` |
| Surface | `#0e1525` |
| Card | `#1a2540` |
| Primary green | `#22c55e` |
| Body font | DM Sans |
| Display font | Outfit |

Use Bootstrap 5 utility classes for spacing, grid, and flex. Custom styles go inside the page's `<style>` block — there are also shared files in `frontend/css/` (`admin.css`, `client.css`, `index.css`) for large pages.

### JavaScript File Conventions

Each page has a matching JS file:

| Page | JS file |
|------|---------|
| `index.html` | *(inline scripts + global.js)* |
| `admin.html` | `adminDashboard.js` |
| `client.html` | `clientDashboard.js` |
| `booking.html` | `booking.js` |
| `track.html` | `track.js` |

Scripts use vanilla `fetch` with `async/await`. There is no module bundler — scripts are plain `<script>` tags. Avoid circular dependencies.

---

## 5. Backend Guide

### Tech Stack

- **Node.js 20+ with ESM** — `"type": "module"` in `package.json`; use `import`/`export` everywhere, never `require()`
- **Express.js 5** — async errors bubble automatically
- **MySQL2/promise** — all DB queries use the pool directly
- **Prisma 6** — used only for schema definition and migrations, **not** as a query client at runtime
- **jsonwebtoken** — JWT signing/verification
- **express-rate-limit** — brute-force and spam protection
- **node-cron** — scheduled background tasks
- **qrcode** — generates PNG buffers for guest booking QR codes
- **googleapis** — Gmail OAuth2 for outbound email

### Entry Point: server.js

`server.js` is the root of the Express app. It wires together:

1. CORS (env-driven whitelist in production, localhost in development)
2. Body parsing (JSON + URL-encoded, 10 KB limit)
3. Rate limiters (auth: 20 req/10 min; global: 200 req/min)
4. Static file serving for `/uploads`
5. Route registration:
   - `GET|POST /api/user/*` — authentication
   - `GET|POST|PUT|PATCH /api/client/*` — client portal
   - `GET|POST|PUT|PATCH|DELETE /api/admin/*` — admin panel
   - `GET|POST /api/public/*` — guest booking (no auth)
6. Cron jobs (midnight: lapse appointments, anonymize deleted accounts; 8 AM: reminders)

### Environment Variables

All secrets and runtime config live in `backend/.env`. Never commit this file.

| Variable | Required | Purpose |
|----------|----------|---------|
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | Default `3000` |
| `DB_HOST` | Yes | MySQL host |
| `DB_PORT` | No | Default `3306` |
| `DB_USER` | Yes | MySQL user |
| `DB_PASSWORD` | Yes | MySQL password |
| `DB_NAME` | Yes | Database name |
| `JWT_SECRET` | Yes | Long random string for JWT signing |
| `APP_URL` | Yes | Frontend base URL (no trailing slash) — used in email links |
| `ALLOWED_ORIGINS` | Yes (prod) | Comma-separated frontend origins for CORS |
| `EMAIL_USER` | Yes | Gmail address for outbound email |
| `CLIENT_ID` | Yes | Google OAuth2 client ID |
| `CLIENT_SECRET` | Yes | Google OAuth2 client secret |
| `REFRESH_TOKEN` | Yes | Gmail OAuth2 refresh token |
| `SUPPORT_EMAIL` | No | Shown in email footers, defaults to `support@randc.com` |
| `DATABASE_URL` | Prisma CLI only | Used by `npx prisma migrate` — not read by runtime code |

`DATABASE_URL` is only needed when running Prisma CLI commands. Runtime DB connections use the individual `DB_*` variables.

### Auth Middleware

Two middleware functions in `src/middleware/auth.js`:

```js
// Verify JWT from Authorization: Bearer <token>
import { isUserAuthenticated, verifyAccessRole } from '../middleware/auth.js';

// On routes that require login:
router.get('/my-data', isUserAuthenticated, myController);

// On routes that require a specific role:
router.delete('/users/:id', isUserAuthenticated, verifyAccessRole('admin'), deleteUser);

// Multiple roles:
router.get('/report', isUserAuthenticated, verifyAccessRole(['admin', 'staff']), getReport);
```

`req.user` is populated by `isUserAuthenticated` and contains `{ id, role, username, email, first_name }`.

### Adding a New Feature (Model → Controller → Route)

Follow this pattern exactly to stay consistent with the 12 existing models.

**1. Model** (`src/model/myFeatureModel.js`):

```js
import { db } from '../config/db.js';

// Simple query
export async function getItemsModel(userId) {
  const [rows] = await db.execute(
    `SELECT id, name FROM items WHERE user_id = ? AND is_active = 1`,
    [userId]
  );
  return rows;
}

// Transaction (multiple writes that must succeed or fail together)
export async function createItemModel({ name, userId }) {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const [result] = await connection.execute(
      `INSERT INTO items (name, user_id) VALUES (?, ?)`,
      [name, userId]
    );
    // ... more inserts if needed
    await connection.commit();
    return result.insertId;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
```

Rules:
- `db.execute(query, [params])` returns `[rows, fields]` — always destructure as `const [rows] = await db.execute(...)`.
- All params go in the second array argument — never string-interpolate user input into SQL.
- Transactions must always call `connection.release()` in `finally`.

**2. Controller** (`src/controller/myFeatureController.js`):

```js
import { getItemsModel, createItemModel } from '../model/myFeatureModel.js';

export async function getItemsController(req, res) {
  try {
    const items = await getItemsModel(req.user.id);
    return res.status(200).json({ items });
  } catch (error) {
    console.error('[myFeatureController] getItems:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function createItemController(req, res) {
  try {
    const { name } = req.body;
    if (!name || name.trim().length === 0)
      return res.status(400).json({ message: 'Name is required.' });

    const id = await createItemModel({ name: name.trim(), userId: req.user.id });
    return res.status(201).json({ id });
  } catch (error) {
    console.error('[myFeatureController] createItem:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
```

Rules:
- Always `return res.status(N).json(...)` — don't fall through.
- Validate at the top of the handler, before any DB call.
- `console.error('[controllerName] handlerName:', error)` as the log format.

**3. Route file** (`src/routes/myFeatureRoutes.js`):

```js
import { Router } from 'express';
import { isUserAuthenticated, verifyAccessRole } from '../middleware/auth.js';
import { getItemsController, createItemController } from '../controller/myFeatureController.js';

const router = Router();

router.get('/',  isUserAuthenticated, getItemsController);
router.post('/', isUserAuthenticated, createItemController);

export default router;
```

**4. Register in server.js**:

```js
import myFeatureRoutes from './src/routes/myFeatureRoutes.js';
// ...
app.use('/api/myfeature', myFeatureRoutes);
```

### Rate Limiting

Three limiters are in play. All use `express-rate-limit`.

| Limiter | Scope | Limit |
|---------|-------|-------|
| Auth brute-force | `/api/user/*` login/signup paths | 20 req / 10 min / IP |
| Global | All routes | 200 req / min / IP |
| Booking (`publicRoutes.js`) | `POST /api/public/book` | 3 req / 15 min / IP |
| Read (`publicRoutes.js`) | Other `/api/public/*` routes | 60 req / min / IP |

To add a limiter to a new route:

```js
import rateLimit from 'express-rate-limit';

const myLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests.' },
});

router.post('/sensitive', myLimiter, myController);
```

### Cron Jobs

All cron jobs live in `server.js`. They run on the backend server's local time.

| Schedule | Task |
|----------|------|
| `0 0 * * *` (midnight) | Auto-lapse appointments past 30 minutes overdue |
| `0 0 * * *` (midnight) | Anonymize accounts deleted >7 days ago |
| `0 8 * * *` (8 AM) | Send reminders for tomorrow's appointments |

To add a new cron job, append to `server.js`:

```js
cron.schedule('0 2 * * *', async () => {
  try {
    // your job
  } catch (err) {
    console.error('[Cron] MyJob error:', err);
  }
});
```

---

## 6. Database Guide

### Two-Layer DB Access

| Layer | Tool | Purpose |
|-------|------|---------|
| Schema + migrations | Prisma | Define tables, run `migrate dev` |
| Runtime queries | MySQL2 raw | All `SELECT`/`INSERT`/`UPDATE`/`DELETE` in model files |

Prisma client is **never imported in model files**. `prisma/schema.prisma` is the source of truth for the schema; MySQL2 is used for all runtime access.

### Connection Pool

`src/config/db.js` exports a single `db` pool (10 connections). Import it in any model:

```js
import { db } from '../config/db.js';
```

In production, SSL is enabled automatically (`ssl: { rejectUnauthorized: false }`).

### Schema Changes (Migrations)

All schema changes go through Prisma migrations.

**Workflow:**

1. Edit `backend/prisma/schema.prisma` to add or modify models.
2. Run the migration:
   ```bash
   cd backend
   npx prisma migrate dev --name describe_your_change
   npx prisma generate
   ```
3. Commit `prisma/schema.prisma` and the generated `prisma/migrations/` files.

**Applying to production:**  
On the Hostinger server, run:
```bash
npx prisma migrate deploy
```
This applies pending migrations without resetting data.

**Important:** Do not run `prisma migrate dev` in production — it can prompt for a DB reset.

### Common Query Patterns

```js
// Single row
const [rows] = await db.execute(`SELECT * FROM users WHERE id = ?`, [id]);
const user = rows[0] ?? null;

// Multiple rows
const [rows] = await db.execute(`SELECT * FROM services WHERE is_active = 1`);

// IN clause with array
const placeholders = ids.map(() => '?').join(', ');
const [rows] = await db.execute(
  `SELECT * FROM services WHERE service_id IN (${placeholders})`,
  ids  // pass array directly
);

// INSERT and get new ID
const [result] = await db.execute(
  `INSERT INTO items (name, user_id) VALUES (?, ?)`,
  [name, userId]
);
const newId = result.insertId;

// UPDATE
await db.execute(
  `UPDATE items SET name = ?, updated_at = NOW() WHERE id = ?`,
  [name, id]
);

// Upsert (INSERT … ON DUPLICATE KEY UPDATE)
await db.execute(
  `INSERT INTO appointment_time_slots (appointment_date, appointment_time, max_capacity, current_bookings)
   VALUES (?, ?, 3, 1)
   ON DUPLICATE KEY UPDATE current_bookings = current_bookings + 1`,
  [date, time]
);
```

### Tables Reference

| Table | Purpose |
|-------|---------|
| `users` | All accounts (admin, client, staff) |
| `appointments` | Client appointments (auth users only) |
| `appointment_time_slots` | Shared slot capacity for both authenticated + guest bookings |
| `appointment_service` | Services linked to appointments |
| `services` | Service catalog |
| `public_bookings` | Guest (no-account) appointment requests |
| `public_booking_services` | Services linked to guest bookings |
| `document_process_transaction` | Document processing jobs |
| `holidays` | Blackout dates for the booking calendar |
| `notifications` | In-app notifications |
| `audit_logs` | Security audit trail |
| `magic_link_tokens` | Passwordless login tokens |
| `user_sessions` | Socket.io connection tracking |
| `user_bans` | Ban records |
| `testimonials` | Client reviews |

---

## 7. Email Service

`src/services/emailService.js` sends transactional email via **Gmail API** (OAuth2), building raw MIME messages manually — not using nodemailer's message builder.

### How It Works

```
sendUserOTP() / sendPublicBookingConfirmation() / etc.
    │
    ├─ buildHeader(title, subtitle)  → green header HTML
    ├─ infoPanel([{ label, value }]) → bordered data table
    ├─ bulletList([...items])        → em-dash bullet list
    ├─ ctaButton(href, label)        → green CTA button
    └─ wrapEmail(header, body)       → full HTML with header + footer
         │
         └─ sendMail({ from, to, subject, html, attachments })
              │
              └─ Builds raw MIME multipart/related
                   ├─ HTML part (base64)
                   ├─ Logo inline (CID: randc-logo@randc.com)
                   └─ Optional attachments
```

### Adding a New Email

```js
export async function sendMyEmail(to, data) {
  const header = buildHeader('Email Title', 'Subtitle text');

  const body = `
    ${infoPanel([
      { label: 'Field', value: data.value },
    ])}
    ${bulletList(['Bullet 1', 'Bullet 2'])}
    ${ctaButton(`${process.env.APP_URL}/page`, 'Go to Page')}
  `;

  await sendMail({
    from:    `"RandC Documentation" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Subject Line',
    html:    wrapEmail(header, body),
  });
}
```

### QR Code Attachments

`sendMail()` reads attachments from file paths via `fs.readFileSync(att.path)`. QR codes generated with `qrcode.toBuffer()` return a `Buffer`, not a file path. Do **not** pass a QR buffer through the `attachments` array.

Instead, build the raw MIME manually and add the QR part directly, as done in `sendPublicBookingConfirmation`. See that function for the full pattern.

### Logo Path

The logo is at `frontend/images/randclogo.png`. `getLogoAttachment()` resolves it from `src/services/` with:

```js
path.join(__dirname, '..', '..', '..', 'frontend', 'images', 'randclogo.png')
```

If the file doesn't exist, emails send without the logo (warning logged, no crash).

---

## 8. Deployment

### Frontend (Vercel)

The `frontend/` folder is the Vercel project root.

1. Push to `main`.
2. Vercel auto-deploys from the `frontend/` directory.
3. No build step — Vercel serves the files statically.
4. `vercel.json` handles routing rewrites.

**Before deploying:** update `BACKEND_PROD_URL` in `frontend/js/global.js` to your actual Hostinger backend URL.

### Backend (Hostinger)

1. SSH into the Hostinger Node.js instance.
2. Pull the latest code.
3. `cd backend && npm install`
4. Run pending DB migrations: `npx prisma migrate deploy`
5. Restart the app (PM2 or Hostinger's restart button):
   ```bash
   pm2 restart randc-backend
   # or
   pm2 start server.js --name randc-backend
   ```

**Env vars** must be set in Hostinger's environment panel (not in a committed `.env`).

**ALLOWED_ORIGINS** must include the Vercel production URL (and any custom domain):
```
ALLOWED_ORIGINS=https://randc.vercel.app,https://yourdomain.com
```

### Health Check

```
GET /health
```

Returns `{ status: 'OK', db: 'ok', uptime: <seconds>, timestamp: <iso> }`.  
If DB is unreachable, `db` is `'error'` and status is still 200 (so the load balancer doesn't kill the process).

---

## Quick Reference

### Backend: Adding a route

1. Write functions in `src/model/<domain>Model.js` using `db.execute()`
2. Write handlers in `src/controller/<domain>Controller.js`
3. Register routes in `src/routes/<domain>Routes.js`
4. Mount in `server.js`: `app.use('/api/<prefix>', routes)`

### Frontend: Adding a page

1. Create `frontend/pages/<name>.html` — load `global.js` first
2. Create `frontend/js/<name>.js` — use `BASE_URL` for all API calls
3. Add rewrite to `frontend/vercel.json`

### DB: Changing schema

1. Edit `backend/prisma/schema.prisma`
2. `npx prisma migrate dev --name <description>` (dev) or `npx prisma migrate deploy` (prod)
3. Commit the schema + generated migration files

### Email: Sending a new type

1. Write a new `export async function sendXxx(...)` in `emailService.js`
2. Use `buildHeader`, `infoPanel`, `bulletList`, `ctaButton`, `wrapEmail`, `sendMail`
3. For Buffer attachments (e.g. QR codes), build the MIME part manually — do not use the `attachments` array
