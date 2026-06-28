# Public Guest Booking — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public guest appointment booking API so guests can book without an account, track their booking via a QR-linked page, and admins can manage guest bookings and slot capacity.

**Architecture:** Raw MySQL2 queries (consistent with all 12 existing models), new `publicModel.js` + `publicController.js` + `publicRoutes.js` files, four new admin handlers folded into existing `adminController.js`, Prisma used only for schema migration.

**Tech Stack:** Express.js 5, MySQL2 (raw), Prisma 6 (migrations only), `qrcode` npm package, Gmail OAuth2 raw MIME emails, Node.js ESM (`"type": "module"`)

## Global Constraints

- All files use ESM `import`/`export` — no `require()`
- MySQL2 pattern: `const [rows] = await db.execute(query, [params])` — never Prisma client
- Transaction pattern: `const connection = await db.getConnection(); await connection.beginTransaction(); ... await connection.commit(); connection.release();` — always in try/catch/finally
- Controller pattern: `try { ... return res.status(N).json(...) } catch (error) { console.error(...); return res.status(500).json({ message }) }`
- Auth middleware: `isUserAuthenticated` + `verifyAccessRole('admin')` from `src/middleware/auth.js`
- No `DATABASE_URL` in runtime code — pool uses `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `APP_URL` env var is the frontend base URL (e.g. `https://randc.vercel.app`) — no trailing slash

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/prisma/schema.prisma` | Add `PublicBookingStatus` enum, `PublicBooking` model, `PublicBookingService` model; add relation to `Service` |
| Create | `backend/src/model/publicModel.js` | All DB queries for public booking feature |
| Create | `backend/src/controller/publicController.js` | Public HTTP handlers: getServices, getSlots, submitBooking, trackBooking |
| Create | `backend/src/routes/publicRoutes.js` | Rate limiters + route registration for `/api/public/*` |
| Modify | `backend/src/services/emailService.js` | Fix broken logo path; add `sendPublicBookingConfirmation` |
| Modify | `backend/src/controller/adminController.js` | Add 4 admin handlers for guest bookings + slot capacity |
| Modify | `backend/src/routes/adminRoutes.js` | Add 4 admin routes |
| Modify | `backend/server.js` | Register `/api/public` route prefix |

---

### Task 1: Prisma Schema + Migration + Install qrcode

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `public_bookings` and `public_booking_services` tables in DB; `qrcode` available to import

- [ ] **Step 1: Add the enum and two new models to schema.prisma**

Open `backend/prisma/schema.prisma`. After the existing `AppointmentStatus` enum (around line 36) add:

```prisma
enum PublicBookingStatus {
  pending
  approved
  completed
  cancelled
  lapsed
}
```

After the `Service` model (around line 336), append the relation field inside `Service` before the closing `}`:

```prisma
  publicBookingServices PublicBookingService[]
```

So the Service model block ends like:

```prisma
model Service {
  serviceId   Int      @id @default(autoincrement()) @map("service_id")
  serviceName String   @unique @map("service_name") @db.VarChar(150)
  description String?  @db.Text
  createdAt   DateTime @default(now()) @map("created_at")
  isActive    Int      @default(1) @map("is_active")

  transactions          DocumentProcessTransaction[]
  appointmentServices   AppointmentService[]
  publicBookingServices PublicBookingService[]

  @@map("services")
}
```

After the `Service` model block, add the two new models:

```prisma
model PublicBooking {
  id              Int                 @id @default(autoincrement())
  trackingToken   String              @unique @map("tracking_token") @db.Char(64)
  email           String              @db.VarChar(255)
  firstName       String              @map("first_name") @db.VarChar(100)
  lastName        String              @map("last_name") @db.VarChar(100)
  phone           String?             @db.VarChar(20)
  appointmentDate DateTime            @map("appointment_date") @db.Date
  appointmentTime DateTime            @map("appointment_time") @db.Time(0)
  notes           String?             @db.Text
  status          PublicBookingStatus @default(pending)
  remarks         String?             @db.VarChar(250)
  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  services        PublicBookingService[]

  @@index([email], name: "idx_email")
  @@map("public_bookings")
}

model PublicBookingService {
  id        Int           @id @default(autoincrement())
  bookingId Int           @map("booking_id")
  serviceId Int           @map("service_id")

  booking   PublicBooking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  service   Service       @relation(fields: [serviceId], references: [serviceId])

  @@map("public_booking_services")
}
```

- [ ] **Step 2: Run the migration**

```bash
cd backend
npx prisma migrate dev --name add_public_bookings
npx prisma generate
```

Expected output includes:
```
✔ Generated Prisma Client
```

If prompted for a migration name, the `--name` flag already provides it.

- [ ] **Step 3: Install qrcode**

```bash
cd backend
npm install qrcode
```

Expected: `added 1 package` (or similar). Verify it appears in `package.json` under `dependencies`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/ backend/package.json backend/package-lock.json
git commit -m "feat: add public_bookings schema + install qrcode"
```

---

### Task 2: publicModel.js

**Files:**
- Create: `backend/src/model/publicModel.js`

**Interfaces:**
- Consumes: `db` from `../config/db.js`
- Produces:
  - `getActiveServicesModel()` → `Promise<Array<{service_id, service_name, description}>>`
  - `getSlotsByDateModel(date: string)` → `Promise<Array<{slot_id, appointment_time, max_capacity, current_bookings, is_available, remaining}>>`
  - `checkSlotCapacityModel(date: string, time: string)` → `Promise<{exists: boolean, hasRoom: boolean, remaining: number}>`
  - `validateServicesExistModel(serviceIds: number[])` → `Promise<Array<{service_id, service_name}>>`
  - `isHolidayModel(date: string)` → `Promise<boolean>`
  - `createPublicBookingModel(opts)` → `Promise<number>` (insertId)
  - `getPublicBookingByTokenModel(token: string)` → `Promise<object|null>`
  - `getAllPublicBookingsModel({status, page, limit, search})` → `Promise<{rows, total}>`
  - `updatePublicBookingStatusModel(id: number, status: string, remarks: string|null)` → `Promise<void>`
  - `getAdminSlotsModel(date: string)` → `Promise<Array>`
  - `updateSlotCapacityModel(slotId: number, maxCapacity: number)` → `Promise<void>`

- [ ] **Step 1: Create the file**

Create `backend/src/model/publicModel.js` with the full content below:

```js
import { db } from '../config/db.js';

export async function getActiveServicesModel() {
  const [rows] = await db.execute(
    `SELECT service_id, service_name, description
     FROM services
     WHERE is_active = 1
     ORDER BY service_name`
  );
  return rows;
}

export async function getSlotsByDateModel(date) {
  const [rows] = await db.execute(
    `SELECT slot_id, appointment_time, max_capacity, current_bookings, is_available
     FROM appointment_time_slots
     WHERE appointment_date = ?
     ORDER BY appointment_time`,
    [date]
  );
  return rows.map(r => ({
    ...r,
    remaining: r.max_capacity - r.current_bookings,
  }));
}

export async function checkSlotCapacityModel(date, time) {
  const [rows] = await db.execute(
    `SELECT slot_id, max_capacity, current_bookings, is_available
     FROM appointment_time_slots
     WHERE appointment_date = ? AND appointment_time = ?`,
    [date, time]
  );
  if (rows.length === 0) {
    return { exists: false, hasRoom: true, remaining: 3 };
  }
  const slot = rows[0];
  const remaining = slot.max_capacity - slot.current_bookings;
  return {
    exists: true,
    hasRoom: remaining > 0 && Boolean(slot.is_available),
    remaining,
  };
}

export async function validateServicesExistModel(serviceIds) {
  const placeholders = serviceIds.map(() => '?').join(', ');
  const [rows] = await db.execute(
    `SELECT service_id, service_name
     FROM services
     WHERE service_id IN (${placeholders}) AND is_active = 1`,
    serviceIds
  );
  return rows;
}

export async function isHolidayModel(date) {
  const [rows] = await db.execute(
    `SELECT holiday_id FROM holidays WHERE holiday_date = ? AND is_active = 1`,
    [date]
  );
  return rows.length > 0;
}

export async function createPublicBookingModel({
  trackingToken,
  email,
  firstName,
  lastName,
  phone,
  appointmentDate,
  appointmentTime,
  notes,
  serviceIds,
}) {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const [result] = await connection.execute(
      `INSERT INTO public_bookings
         (tracking_token, email, first_name, last_name, phone,
          appointment_date, appointment_time, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [trackingToken, email, firstName, lastName, phone ?? null,
       appointmentDate, appointmentTime, notes ?? null]
    );
    const bookingId = result.insertId;

    for (const serviceId of serviceIds) {
      await connection.execute(
        `INSERT INTO public_booking_services (booking_id, service_id) VALUES (?, ?)`,
        [bookingId, serviceId]
      );
    }

    await connection.execute(
      `INSERT INTO appointment_time_slots
         (appointment_date, appointment_time, max_capacity, current_bookings, is_available)
       VALUES (?, ?, 3, 1, 1)
       ON DUPLICATE KEY UPDATE
         current_bookings = current_bookings + 1,
         is_available = IF(current_bookings + 1 >= max_capacity, 0, 1)`,
      [appointmentDate, appointmentTime]
    );

    await connection.commit();
    return bookingId;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function getPublicBookingByTokenModel(token) {
  const [rows] = await db.execute(
    `SELECT
       pb.id,
       pb.tracking_token   AS trackingToken,
       pb.first_name       AS firstName,
       pb.appointment_date AS appointmentDate,
       pb.appointment_time AS appointmentTime,
       pb.status,
       pb.remarks,
       pb.updated_at       AS updatedAt,
       s.service_name      AS serviceName
     FROM public_bookings pb
     LEFT JOIN public_booking_services pbs ON pbs.booking_id = pb.id
     LEFT JOIN services s ON s.service_id = pbs.service_id
     WHERE pb.tracking_token = ?`,
    [token]
  );
  if (rows.length === 0) return null;
  const { id, trackingToken, firstName, appointmentDate, appointmentTime,
          status, remarks, updatedAt } = rows[0];
  const services = rows
    .filter(r => r.serviceName)
    .map(r => ({ serviceName: r.serviceName }));
  return { id, trackingToken, firstName, appointmentDate, appointmentTime,
           status, remarks, updatedAt, services };
}

export async function getAllPublicBookingsModel({ status, page, limit, search }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    conditions.push('pb.status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('(pb.first_name LIKE ? OR pb.last_name LIKE ? OR pb.email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await db.execute(
    `SELECT COUNT(DISTINCT pb.id) AS total FROM public_bookings pb ${where}`,
    params
  );
  const total = countRows[0].total;

  const [rows] = await db.execute(
    `SELECT
       pb.id,
       pb.tracking_token   AS trackingToken,
       pb.email,
       pb.first_name       AS firstName,
       pb.last_name        AS lastName,
       pb.phone,
       pb.appointment_date AS appointmentDate,
       pb.appointment_time AS appointmentTime,
       pb.status,
       pb.remarks,
       pb.created_at       AS createdAt,
       GROUP_CONCAT(s.service_name ORDER BY s.service_name SEPARATOR ', ') AS services
     FROM public_bookings pb
     LEFT JOIN public_booking_services pbs ON pbs.booking_id = pb.id
     LEFT JOIN services s ON s.service_id = pbs.service_id
     ${where}
     GROUP BY pb.id
     ORDER BY pb.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { rows, total };
}

export async function updatePublicBookingStatusModel(id, status, remarks) {
  await db.execute(
    `UPDATE public_bookings
     SET status = ?, remarks = ?, updated_at = NOW()
     WHERE id = ?`,
    [status, remarks ?? null, id]
  );
}

export async function getAdminSlotsModel(date) {
  const [rows] = await db.execute(
    `SELECT slot_id, appointment_time, max_capacity, current_bookings, is_available
     FROM appointment_time_slots
     WHERE appointment_date = ?
     ORDER BY appointment_time`,
    [date]
  );
  return rows;
}

export async function updateSlotCapacityModel(slotId, maxCapacity) {
  await db.execute(
    `UPDATE appointment_time_slots
     SET max_capacity = ?,
         is_available = IF(current_bookings >= ?, 0, 1)
     WHERE slot_id = ?`,
    [maxCapacity, maxCapacity, slotId]
  );
}
```

- [ ] **Step 2: Verify the file saved correctly**

```bash
node --input-type=module <<'EOF'
import './src/model/publicModel.js';
console.log('publicModel imports OK');
EOF
```

Run from `backend/`. Expected: `publicModel imports OK` (no errors; the DB connection will not be used).

- [ ] **Step 3: Commit**

```bash
git add backend/src/model/publicModel.js
git commit -m "feat: add publicModel with all guest booking DB queries"
```

---

### Task 3: publicController.js

**Files:**
- Create: `backend/src/controller/publicController.js`

**Interfaces:**
- Consumes:
  - `getActiveServicesModel`, `getSlotsByDateModel`, `checkSlotCapacityModel`, `validateServicesExistModel`, `isHolidayModel`, `createPublicBookingModel`, `getPublicBookingByTokenModel` from `../model/publicModel.js`
  - `sendPublicBookingConfirmation` from `../services/emailService.js` (written in Task 5 — import it now, the runtime call is fire-and-forget so a missing export won't break the handler during testing until Task 5 is done)
- Produces:
  - `getServices(req, res)` — exported named function
  - `getSlots(req, res)` — exported named function
  - `submitBooking(req, res)` — exported named function
  - `trackBooking(req, res)` — exported named function

- [ ] **Step 1: Create the file**

Create `backend/src/controller/publicController.js`:

```js
import crypto from 'crypto';
import QRCode from 'qrcode';
import {
  getActiveServicesModel,
  getSlotsByDateModel,
  checkSlotCapacityModel,
  validateServicesExistModel,
  isHolidayModel,
  createPublicBookingModel,
  getPublicBookingByTokenModel,
} from '../model/publicModel.js';
import { sendPublicBookingConfirmation } from '../services/emailService.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE  = /^[A-Za-z\s\-]+$/;
const PHONE_RE = /^(\+?63|0)[0-9]{9,10}$/;

export async function getServices(req, res) {
  try {
    const services = await getActiveServicesModel();
    return res.status(200).json({ services });
  } catch (error) {
    console.error('[publicController] getServices:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getSlots(req, res) {
  try {
    const { date } = req.query;
    if (!date)
      return res.status(400).json({ message: 'date query param is required.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(date) < today)
      return res.status(400).json({ message: 'Cannot query slots for a past date.' });

    const rows = await getSlotsByDateModel(date);
    const slots = rows.map(r => ({
      time:            r.appointment_time,
      maxCapacity:     r.max_capacity,
      currentBookings: r.current_bookings,
      remaining:       r.remaining,
      isAvailable:     Boolean(r.is_available),
    }));
    return res.status(200).json({ slots });
  } catch (error) {
    console.error('[publicController] getSlots:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function submitBooking(req, res) {
  try {
    const { firstName, lastName, email, phone,
            serviceIds, appointmentDate, appointmentTime, notes } = req.body;

    // Name validation
    if (!firstName || typeof firstName !== 'string'
        || firstName.trim().length < 2 || firstName.trim().length > 50
        || !NAME_RE.test(firstName.trim()))
      return res.status(400).json({ message: 'First name must be 2–50 letters.' });
    if (!lastName || typeof lastName !== 'string'
        || lastName.trim().length < 2 || lastName.trim().length > 50
        || !NAME_RE.test(lastName.trim()))
      return res.status(400).json({ message: 'Last name must be 2–50 letters.' });

    // Email
    if (!email || !EMAIL_RE.test(email))
      return res.status(400).json({ message: 'A valid email address is required.' });

    // Phone (optional)
    if (phone && !PHONE_RE.test(phone))
      return res.status(400).json({ message: 'Invalid phone number format.' });

    // Services
    if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 7
        || !serviceIds.every(id => Number.isInteger(id) && id > 0))
      return res.status(400).json({ message: 'Select 1–7 valid services.' });

    // Date
    if (!appointmentDate || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate))
      return res.status(400).json({ message: 'Invalid appointment date.' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const apptDate = new Date(appointmentDate);
    if (apptDate < today)
      return res.status(400).json({ message: 'Appointment date cannot be in the past.' });
    if (apptDate.getDay() === 0)
      return res.status(400).json({ message: 'Appointments are not available on Sundays.' });

    // Time
    if (!appointmentTime || !/^\d{1,2}:\d{2}$/.test(appointmentTime))
      return res.status(400).json({ message: 'Invalid appointment time format.' });

    // Notes
    if (notes && notes.length > 500)
      return res.status(400).json({ message: 'Notes must be 500 characters or fewer.' });

    // Holiday check
    const holiday = await isHolidayModel(appointmentDate);
    if (holiday)
      return res.status(400).json({ message: 'The selected date is a holiday.' });

    // Validate services exist
    const validServices = await validateServicesExistModel(serviceIds);
    if (validServices.length !== serviceIds.length)
      return res.status(400).json({ message: 'One or more selected services are invalid.' });

    // Slot capacity
    const slotCheck = await checkSlotCapacityModel(appointmentDate, appointmentTime);
    if (!slotCheck.hasRoom)
      return res.status(409).json({ message: 'This time slot is fully booked. Please choose another.' });

    // Create booking
    const trackingToken = crypto.randomBytes(32).toString('hex');
    await createPublicBookingModel({
      trackingToken,
      email,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      phone:     phone || null,
      appointmentDate,
      appointmentTime,
      notes:     notes || null,
      serviceIds,
    });

    const trackingUrl  = `${process.env.APP_URL}/track/${trackingToken}`;
    const qrBuffer     = await QRCode.toBuffer(trackingUrl, { width: 300, margin: 2 });
    const bookingRef   = trackingToken.slice(-8).toUpperCase();
    const serviceNames = validServices.map(s => s.service_name);

    sendPublicBookingConfirmation({
      email,
      firstName:       firstName.trim(),
      lastName:        lastName.trim(),
      appointmentDate,
      appointmentTime,
      services:        serviceNames,
      trackingUrl,
      qrBuffer,
      bookingRef,
    }).catch(err => console.error('[email] sendPublicBookingConfirmation failed:', err));

    return res.status(200).json({
      success: true,
      message: 'Booking confirmed. Check your email for your QR code.',
    });
  } catch (error) {
    console.error('[publicController] submitBooking:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function trackBooking(req, res) {
  try {
    const { token } = req.params;
    if (!token || token.length !== 64)
      return res.status(404).json({ message: 'Booking not found.' });

    const booking = await getPublicBookingByTokenModel(token);
    if (!booking)
      return res.status(404).json({ message: 'Booking not found.' });

    return res.status(200).json(booking);
  } catch (error) {
    console.error('[publicController] trackBooking:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/controller/publicController.js
git commit -m "feat: add publicController with getServices, getSlots, submitBooking, trackBooking"
```

---

### Task 4: publicRoutes.js + Register in server.js

**Files:**
- Create: `backend/src/routes/publicRoutes.js`
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `getServices`, `getSlots`, `submitBooking`, `trackBooking` from `../controller/publicController.js`
- Produces: Express router mounted at `/api/public` in server.js

- [ ] **Step 1: Create publicRoutes.js**

Create `backend/src/routes/publicRoutes.js`:

```js
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getServices,
  getSlots,
  submitBooking,
  trackBooking,
} from '../controller/publicController.js';

const router = Router();

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many booking attempts. Please wait 15 minutes before trying again.' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

router.get('/services',     readLimiter,    getServices);
router.get('/slots',        readLimiter,    getSlots);
router.post('/book',        bookingLimiter, submitBooking);
router.get('/track/:token', readLimiter,    trackBooking);

export default router;
```

- [ ] **Step 2: Register in server.js**

In `backend/server.js`, after the existing imports block (around line 15), add:

```js
import publicRoutes from './src/routes/publicRoutes.js';
```

Then after line 78 (`app.use('/api/admin', adminRoutes);`), add:

```js
app.use('/api/public', publicRoutes);
```

The routes section should look like:

```js
// API Routes
app.use('/api/user',   userRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/admin',  adminRoutes);
app.use('/api/public', publicRoutes);
```

- [ ] **Step 3: Smoke test — start the server and hit /api/public/services**

```bash
cd backend
npm run dev
```

In a second terminal:

```bash
curl http://localhost:3000/api/public/services
```

Expected: `{"services":[...]}` — a JSON array of your active services. If DB is empty, `{"services":[]}` is fine.

```bash
curl "http://localhost:3000/api/public/slots?date=2026-07-01"
```

Expected: `{"slots":[]}` or a list — no 500 error.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/publicRoutes.js backend/server.js
git commit -m "feat: add publicRoutes and register /api/public in server"
```

---

### Task 5: Fix emailService.js + Add sendPublicBookingConfirmation

**Files:**
- Modify: `backend/src/services/emailService.js`

**Interfaces:**
- Consumes: all existing email helpers (`wrapEmail`, `buildHeader`, `infoPanel`, `bulletList`, `getLogoAttachment`, `oauth2Client`, `google`), `fs` — all already in scope in the file
- Produces: `sendPublicBookingConfirmation({ email, firstName, lastName, appointmentDate, appointmentTime, services, trackingUrl, qrBuffer, bookingRef })` — exported async function

**Key constraint on QR code:** `sendMail()` reads attachments via `fs.readFileSync(att.path)` and cannot accept a Buffer directly. `sendPublicBookingConfirmation` builds its own raw MIME string to inline the QR buffer as a CID part — it does NOT call `sendMail()`.

- [ ] **Step 1: Fix the broken logo path**

In `backend/src/services/emailService.js` line 29, change:

```js
  const logoPath = path.join(__dirname, "..", "..", "public", "images", "randclogo.png");
```

To:

```js
  const logoPath = path.join(__dirname, "..", "..", "..", "frontend", "images", "randclogo.png");
```

(3 levels up from `src/services/` reaches the repo root, then into `frontend/images/`)

- [ ] **Step 2: Add sendPublicBookingConfirmation at the bottom of the file**

Append the following export at the very end of `backend/src/services/emailService.js` (after the last existing export):

```js
// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC BOOKING CONFIRMATION  (QR code inlined as CID — no file path needed)
// ─────────────────────────────────────────────────────────────────────────────
export async function sendPublicBookingConfirmation({
  email,
  firstName,
  lastName,
  appointmentDate,
  appointmentTime,
  services,
  trackingUrl,
  qrBuffer,
  bookingRef,
}) {
  const QR_CID = 'qrcode@randc.com';

  const formattedDate = new Date(appointmentDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  const [h, m]  = String(appointmentTime).split(':');
  const hour    = parseInt(h, 10);
  const ampm    = hour >= 12 ? 'PM' : 'AM';
  const hour12  = hour % 12 || 12;
  const formattedTime = `${hour12}:${m} ${ampm}`;

  const header = buildHeader(
    'Appointment Request Received',
    `Hi ${firstName}, we've received your booking request.`
  );

  const body = `
    ${infoPanel([
      { label: 'Name',     value: `${firstName} ${lastName}` },
      { label: 'Date',     value: formattedDate },
      { label: 'Time',     value: formattedTime },
      { label: 'Services', value: services.join(', ') },
      { label: 'Ref',      value: `#${bookingRef}` },
    ])}
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="margin-bottom:24px;">
      <tr>
        <td align="center" style="padding:20px 0;">
          <img src="cid:${QR_CID}" width="200" alt="QR Code"
               style="width:200px;height:200px;display:block;margin:0 auto;" />
          <p style="font-size:12px;color:#000000;margin:12px 0 0;line-height:1.5;">
            Scan to track your appointment
          </p>
        </td>
      </tr>
    </table>
    <p style="font-size:13px;color:#000000;line-height:1.75;margin:0 0 20px;word-break:break-all;">
      Or visit: <a href="${trackingUrl}" style="color:#22c55e;">${trackingUrl}</a>
    </p>
    ${bulletList([
      'Your request will be reviewed within 1 business day.',
      'Scan the QR code or visit the link above to check your status.',
      'Bring a valid ID and documents to your appointment.',
    ])}
  `;

  const html           = wrapEmail(header, body);
  const fromAddress    = process.env.EMAIL_FROM || process.env.SUPPORT_EMAIL || 'noreply@randc.com';
  const gmail          = google.gmail({ version: 'v1', auth: oauth2Client });
  const encodedSubject = `=?UTF-8?B?${Buffer.from('Appointment Request Received — RandC').toString('base64')}?=`;
  const boundary       = `randc_boundary_${Date.now()}`;
  const logoAttach     = getLogoAttachment();

  let mime = [
    `From: ${fromAddress}`,
    `To: ${email}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(html, 'utf8').toString('base64'),
  ].join('\r\n');

  if (logoAttach) {
    try {
      const logoData = fs.readFileSync(logoAttach.path);
      mime += '\r\n' + [
        `--${boundary}`,
        `Content-Type: image/png; name="randclogo.png"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: inline`,
        `Content-ID: <${LOGO_CID}>`,
        ``,
        logoData.toString('base64'),
      ].join('\r\n');
    } catch { /* logo missing — skip */ }
  }

  mime += '\r\n' + [
    `--${boundary}`,
    `Content-Type: image/png; name="qrcode.png"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: inline`,
    `Content-ID: <${QR_CID}>`,
    ``,
    qrBuffer.toString('base64'),
  ].join('\r\n');

  mime += `\r\n--${boundary}--`;

  const raw = Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/emailService.js
git commit -m "fix: correct logo path in emailService; add sendPublicBookingConfirmation"
```

---

### Task 6: Admin Handlers + Admin Routes

**Files:**
- Modify: `backend/src/controller/adminController.js`
- Modify: `backend/src/routes/adminRoutes.js`

**Interfaces:**
- Consumes: `getAllPublicBookingsModel`, `updatePublicBookingStatusModel`, `getAdminSlotsModel`, `updateSlotCapacityModel` from `../model/publicModel.js`
- Produces:
  - `listGuestBookingsController(req, res)` — exported named function
  - `updateGuestBookingStatusController(req, res)` — exported named function
  - `getAdminSlotsController(req, res)` — exported named function
  - `updateSlotCapacityController(req, res)` — exported named function

- [ ] **Step 1: Add imports to adminController.js**

At the top of `backend/src/controller/adminController.js`, after the existing imports (after line 24 — after the `holidayModel.js` import block), add:

```js
import {
  getAllPublicBookingsModel,
  updatePublicBookingStatusModel,
  getAdminSlotsModel,
  updateSlotCapacityModel,
} from '../model/publicModel.js';
```

- [ ] **Step 2: Add the 4 handler functions to adminController.js**

Append at the very end of `backend/src/controller/adminController.js`:

```js
// ─── GUEST BOOKINGS ──────────────────────────────────────────────────────────

const VALID_BOOKING_STATUSES = ['pending', 'approved', 'completed', 'cancelled', 'lapsed'];

export async function listGuestBookingsController(req, res) {
  try {
    const status = req.query.status || 'all';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const search = req.query.search?.trim() || '';

    const { rows, total } = await getAllPublicBookingsModel({ status, page, limit, search });
    return res.status(200).json({ bookings: rows, total, page, limit });
  } catch (error) {
    console.error('[adminController] listGuestBookings:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateGuestBookingStatusController(req, res) {
  try {
    const id      = parseInt(req.params.id);
    const { status, remarks } = req.body;

    if (!id || id < 1)
      return res.status(400).json({ message: 'Invalid booking ID.' });
    if (!VALID_BOOKING_STATUSES.includes(status))
      return res.status(400).json({ message: 'Invalid status value.' });

    await updatePublicBookingStatusModel(id, status, remarks ?? null);
    return res.status(200).json({ message: 'Status updated.' });
  } catch (error) {
    console.error('[adminController] updateGuestBookingStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getAdminSlotsController(req, res) {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ message: 'date query param is required (YYYY-MM-DD).' });

    const slots = await getAdminSlotsModel(date);
    return res.status(200).json({
      slots: slots.map(s => ({
        slotId:          s.slot_id,
        time:            s.appointment_time,
        maxCapacity:     s.max_capacity,
        currentBookings: s.current_bookings,
        isAvailable:     Boolean(s.is_available),
      })),
    });
  } catch (error) {
    console.error('[adminController] getAdminSlots:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateSlotCapacityController(req, res) {
  try {
    const slotId      = parseInt(req.params.slotId);
    const maxCapacity = parseInt(req.body.maxCapacity);

    if (!slotId || slotId < 1)
      return res.status(400).json({ message: 'Invalid slot ID.' });
    if (!Number.isInteger(maxCapacity) || maxCapacity < 1 || maxCapacity > 20)
      return res.status(400).json({ message: 'maxCapacity must be an integer between 1 and 20.' });

    await updateSlotCapacityModel(slotId, maxCapacity);
    return res.status(200).json({ message: 'Slot capacity updated.' });
  } catch (error) {
    console.error('[adminController] updateSlotCapacity:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
```

- [ ] **Step 3: Add imports + routes to adminRoutes.js**

In `backend/src/routes/adminRoutes.js`, add the 4 new controller names to the existing import from `adminController.js`. The import block starts at line 2. Add these four names to it:

```js
  listGuestBookingsController,
  updateGuestBookingStatusController,
  getAdminSlotsController,
  updateSlotCapacityController,
```

Then at the very end of the file (after the last existing route), add:

```js
// GUEST BOOKINGS
router.get('/guest-bookings', isUserAuthenticated, verifyAccessRole('admin'), listGuestBookingsController);
router.patch('/guest-bookings/:id/status', isUserAuthenticated, verifyAccessRole('admin'), updateGuestBookingStatusController);

// SLOT CAPACITY
router.get('/slots', isUserAuthenticated, verifyAccessRole('admin'), getAdminSlotsController);
router.patch('/slots/:slotId', isUserAuthenticated, verifyAccessRole('admin'), updateSlotCapacityController);
```

- [ ] **Step 4: Smoke test admin routes**

With the server running (Task 4 Step 3), test with a valid admin JWT:

```bash
curl -H "Authorization: Bearer <admin_jwt>" \
  "http://localhost:3000/api/admin/guest-bookings?status=all"
```

Expected: `{"bookings":[],"total":0,"page":1,"limit":20}` (empty if no bookings yet — no 500 or 401 errors).

```bash
curl -H "Authorization: Bearer <admin_jwt>" \
  "http://localhost:3000/api/admin/slots?date=2026-07-01"
```

Expected: `{"slots":[]}` or list of slots — no 500 error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controller/adminController.js backend/src/routes/adminRoutes.js
git commit -m "feat: add guest booking and slot capacity admin handlers + routes"
```

---

### Task 7: End-to-End Smoke Test + Env Var Check

**Files:** none created — verification only

- [ ] **Step 1: Verify APP_URL is set**

The `submitBooking` handler reads `process.env.APP_URL` to build the tracking URL. Confirm it exists in `.env`:

```
APP_URL=https://your-frontend.vercel.app
```

For local testing use `APP_URL=http://localhost:3000` (or wherever the frontend runs).

- [ ] **Step 2: Submit a test booking end-to-end**

With the server running:

```bash
curl -s -X POST http://localhost:3000/api/public/book \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "Guest",
    "email": "test@example.com",
    "serviceIds": [1],
    "appointmentDate": "2026-08-01",
    "appointmentTime": "09:00"
  }' | jq .
```

Expected:
```json
{
  "success": true,
  "message": "Booking confirmed. Check your email for your QR code."
}
```

- [ ] **Step 3: Track the booking**

Find the `tracking_token` of the booking you just created:

```bash
# In MySQL or via a DB client:
SELECT tracking_token FROM public_bookings ORDER BY id DESC LIMIT 1;
```

Then:

```bash
curl http://localhost:3000/api/public/track/<token_from_above> | jq .
```

Expected: booking object with `status: "pending"`, service list, no `email` field.

- [ ] **Step 4: Final commit (if any fixes were made)**

```bash
git add -p   # stage only the fix changes
git commit -m "fix: <describe fix>"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec section | Task |
|---|---|
| `public_bookings` table | Task 1 |
| `public_booking_services` table | Task 1 |
| `PublicBookingStatus` enum | Task 1 |
| `qrcode` package | Task 1 |
| `getActiveServicesModel` | Task 2 |
| `getSlotsByDateModel` | Task 2 |
| `checkSlotCapacityModel` | Task 2 |
| `validateServicesExistModel` | Task 2 |
| `isHolidayModel` | Task 2 |
| `createPublicBookingModel` (transaction) | Task 2 |
| `getPublicBookingByTokenModel` | Task 2 |
| `getAllPublicBookingsModel` | Task 2 |
| `updatePublicBookingStatusModel` | Task 2 |
| `getAdminSlotsModel` | Task 2 |
| `updateSlotCapacityModel` | Task 2 |
| `GET /api/public/services` | Tasks 3, 4 |
| `GET /api/public/slots` | Tasks 3, 4 |
| `POST /api/public/book` (full validation) | Tasks 3, 4 |
| `GET /api/public/track/:token` | Tasks 3, 4 |
| Rate limiters (3/15min booking, 60/min read) | Task 4 |
| Register `/api/public` in server.js | Task 4 |
| Fix logo path | Task 5 |
| `sendPublicBookingConfirmation` + QR CID inline | Task 5 |
| `listGuestBookingsController` | Task 6 |
| `updateGuestBookingStatusController` | Task 6 |
| `getAdminSlotsController` | Task 6 |
| `updateSlotCapacityController` | Task 6 |
| Admin routes (4 new) | Task 6 |
| `APP_URL` env var usage | Task 7 |
| Fire-and-forget email | Task 3 (`submitBooking`) |
| `ON DUPLICATE KEY UPDATE` slot increment | Task 2 |
| Never return `email` from track endpoint | Task 2 (`getPublicBookingByTokenModel`) |
