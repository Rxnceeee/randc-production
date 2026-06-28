# Public Guest Booking — Backend Design

**Date:** 2026-06-28  
**Scope:** Backend only. Frontend already implemented separately.  
**Stack:** Express.js 5, MySQL2 (raw queries), Prisma 6 (migrations only), Node.js ESM

---

## 1. Overview

Add a public appointment booking system. Guests book without an account — only an email is required for legitimacy. On success, a QR code PNG is emailed to them; the QR links to a read-only tracking page showing appointment status. Admin can view and manage guest bookings in a dedicated panel, and can edit per-slot capacity.

---

## 2. Database Changes

### New Prisma enum

```prisma
enum PublicBookingStatus {
  pending
  approved
  completed
  cancelled
  lapsed
}
```

### New model: `public_bookings`

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK auto | |
| `tracking_token` | CHAR(64) UNIQUE | `crypto.randomBytes(32).toString('hex')` |
| `email` | VARCHAR(255) | |
| `first_name` | VARCHAR(100) | |
| `last_name` | VARCHAR(100) | |
| `phone` | VARCHAR(20) NULL | |
| `appointment_date` | DATE | |
| `appointment_time` | TIME | |
| `notes` | TEXT NULL | |
| `status` | PublicBookingStatus | default `pending` |
| `remarks` | VARCHAR(250) NULL | admin-visible note shown on tracking page |
| `created_at` | DATETIME | default now |
| `updated_at` | DATETIME | auto-update |

Index on `email`.

### New model: `public_booking_services`

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK auto | |
| `booking_id` | INT | FK → `public_bookings.id` CASCADE DELETE |
| `service_id` | INT | FK → `services.service_id` |

### Existing `Service` model

Add relation field `publicBookingServices PublicBookingService[]`.

### Migration command

```bash
cd backend
npx prisma migrate dev --name add_public_bookings
npx prisma generate
```

---

## 3. New Package

```bash
cd backend && npm install qrcode
```

---

## 4. New File: `backend/src/model/publicModel.js`

Uses raw MySQL2 (`db` from `../config/db.js`). No Prisma client.

### Exported functions

**`getActiveServicesModel()`**  
`SELECT service_id, service_name, description FROM services WHERE is_active = 1 ORDER BY service_name`

**`getSlotsByDateModel(date)`**  
`SELECT slot_id, appointment_time, max_capacity, current_bookings, is_available FROM appointment_time_slots WHERE appointment_date = ?`  
Returns array with derived `remaining = max_capacity - current_bookings`.

**`checkSlotCapacityModel(date, time)`**  
Returns `{ exists: bool, hasRoom: bool, remaining: int }`. Queries `appointment_time_slots WHERE appointment_date=? AND appointment_time=?`. If no row exists, treat as available (capacity 3, 0 booked).

**`validateServicesExistModel(serviceIds[])`**  
`SELECT service_id, service_name FROM services WHERE service_id IN (?) AND is_active = 1`  
Returns array of `{ service_id, service_name }` — caller checks length matches input length. The names are reused for the email; no second query needed.

**`isHolidayModel(date)`**  
`SELECT holiday_id FROM holidays WHERE holiday_date = ? AND is_active = 1`  
Returns boolean.

**`createPublicBookingModel({ trackingToken, email, firstName, lastName, phone, appointmentDate, appointmentTime, notes, serviceIds })`**  
Runs in a single MySQL transaction:
1. `INSERT INTO public_bookings (...) VALUES (?)`
2. `INSERT INTO public_booking_services (booking_id, service_id) VALUES ...` (one row per serviceId)
3. `INSERT INTO appointment_time_slots (appointment_date, appointment_time, max_capacity, current_bookings, is_available) VALUES (?, ?, 3, 1, 1) ON DUPLICATE KEY UPDATE current_bookings = current_bookings + 1, is_available = IF(current_bookings + 1 >= max_capacity, 0, 1)`

Returns `insertId` of the new booking.

**`getPublicBookingByTokenModel(token)`**  
Joins `public_bookings` with `public_booking_services` + `services`. Returns `{ id, trackingToken, firstName, appointmentDate, appointmentTime, status, remarks, updatedAt, services: [{ serviceName }] }`. **Never returns email.**

**`getAllPublicBookingsModel({ status, page, limit, search })`**  
Admin list with pagination. Joins services. Filters by `status` (if not 'all') and search (name/email LIKE). Returns `{ rows, total }`.

**`updatePublicBookingStatusModel(id, status, remarks)`**  
`UPDATE public_bookings SET status = ?, remarks = ?, updated_at = NOW() WHERE id = ?`

**`getAdminSlotsModel(date)`**  
`SELECT slot_id, appointment_time, max_capacity, current_bookings, is_available FROM appointment_time_slots WHERE appointment_date = ? ORDER BY appointment_time`

**`updateSlotCapacityModel(slotId, maxCapacity)`**  
`UPDATE appointment_time_slots SET max_capacity = ?, is_available = IF(current_bookings >= ?, 0, 1) WHERE slot_id = ?`

---

## 5. New File: `backend/src/controller/publicController.js`

### Public handlers

**`getServices(req, res)`**  
Calls `getActiveServicesModel()`. Returns `{ services: [...] }`.

**`getSlots(req, res)`**  
Query param `date` (required). Validates format and not-in-past. Calls `getSlotsByDateModel(date)`. Returns `{ slots: [{ time, maxCapacity, currentBookings, remaining, isAvailable }] }`.

**`submitBooking(req, res)`**  
Full validation, then booking creation flow:

*Validation rules:*
| Field | Rule |
|---|---|
| `firstName`, `lastName` | Required, 2–50 chars, `/^[A-Za-z\s\-]+$/` |
| `email` | Required, valid email regex |
| `phone` | Optional — if provided: `/^(\+?63\|0)[0-9]{9,10}$/` |
| `serviceIds` | Required array, 1–7 items, each positive integer |
| `appointmentDate` | Required, not in past, not Sunday (`getDay() !== 0`), not a holiday |
| `appointmentTime` | Required, format `HH:MM` or `H:MM` |
| `notes` | Optional, max 500 chars |

*After validation:*
1. Validate all serviceIds exist via `validateServicesExistModel`
2. Check slot capacity via `checkSlotCapacityModel` → 409 if full
3. Generate `trackingToken = crypto.randomBytes(32).toString('hex')`
4. Call `createPublicBookingModel(...)`
5. Build `trackingUrl = ${process.env.APP_URL}/track/${trackingToken}`
6. `qrBuffer = await QRCode.toBuffer(trackingUrl, { width: 300, margin: 2 })`
7. Compute `bookingRef = trackingToken.slice(-8).toUpperCase()`
8. Extract service names from the already-validated services array
9. Fire-and-forget: `sendPublicBookingConfirmation({ email, firstName, lastName, appointmentDate, appointmentTime, services: serviceNames, trackingUrl, qrBuffer, bookingRef }).catch(err => console.error('[email]', err))`
9. Return `200 { success: true, message: 'Booking confirmed. Check your email for your QR code.' }`

**`trackBooking(req, res)`**  
Param `:token`. Calls `getPublicBookingByTokenModel(token)`. 404 if not found. Returns booking object (no email field).

### Admin handlers (added to `adminController.js`)

**`listGuestBookingsController(req, res)`**  
Query: `?status=all&page=1&limit=20&search=`. Calls `getAllPublicBookingsModel(...)`. Returns `{ bookings, total, page, limit }`.

**`updateGuestBookingStatusController(req, res)`**  
Param `:id`. Body: `{ status, remarks? }`. Validates status is a valid enum value. Calls `updatePublicBookingStatusModel(id, status, remarks)`.

**`getAdminSlotsController(req, res)`**  
Query: `?date=YYYY-MM-DD`. Calls `getAdminSlotsModel(date)`. Returns `{ slots: [{ slotId, time, maxCapacity, currentBookings, isAvailable }] }`.

**`updateSlotCapacityController(req, res)`**  
Param `:slotId`. Body: `{ maxCapacity }`. Validates integer 1–20. Calls `updateSlotCapacityModel(slotId, maxCapacity)`.

---

## 6. New File: `backend/src/routes/publicRoutes.js`

```
Rate limiters:
  bookingLimiter: 3 req / 15 min / IP  (POST /book only)
  readLimiter:    60 req / min / IP     (all other public routes)

Routes:
  GET  /services        readLimiter   → getServices
  GET  /slots           readLimiter   → getSlots
  POST /book            bookingLimiter → submitBooking
  GET  /track/:token    readLimiter   → trackBooking
```

---

## 7. Updates to `backend/src/routes/adminRoutes.js`

Add 4 new imports from `adminController.js` and register routes (after existing auth middleware pattern):

```
GET   /guest-bookings              isUserAuthenticated + admin → listGuestBookingsController
PATCH /guest-bookings/:id/status   isUserAuthenticated + admin → updateGuestBookingStatusController
GET   /slots                       isUserAuthenticated + admin → getAdminSlotsController
PATCH /slots/:slotId               isUserAuthenticated + admin → updateSlotCapacityController
```

---

## 8. Updates to `backend/server.js`

Add import and register:
```js
import publicRoutes from './src/routes/publicRoutes.js';
app.use('/api/public', publicRoutes);
```

Placed after the existing `app.use('/api/admin', adminRoutes)` line.

---

## 9. Updates to `backend/src/services/emailService.js`

**Fix logo path** (line 29):  
Change `path.join(__dirname, "..", "..", "public", "images", "randclogo.png")`  
To: `path.join(__dirname, "..", "..", "..", "frontend", "images", "randclogo.png")`

**Add `sendPublicBookingConfirmation({ email, firstName, lastName, appointmentDate, appointmentTime, services, trackingUrl, qrBuffer, bookingRef })`**

Builds a raw MIME email using existing helpers (`wrapEmail`, `buildHeader`, `infoPanel`, `ctaButton`, `bulletList`, `hr`).

QR code is attached as a second inline CID part (`qrcode@randc.com`) alongside the logo. The MIME `Content-Type` of the QR attachment is `image/png`, `Content-Disposition: inline`, `Content-Transfer-Encoding: base64`.

Email content:
- Header: "Appointment Request Received"
- Info panel: Name, Date (formatted), Time (12h), Services (comma-joined), Ref (`#XXXXXXXX` = last 8 chars of token, uppercase)
- `<img src="cid:qrcode@randc.com" width="200" />` centered section with caption
- Plain-text tracking URL as fallback link
- Bullet list: "Your request will be reviewed within 1 business day", "Scan the QR code or visit the link above to check your status", "Bring a valid ID and documents to your appointment"

---

## 10. Error Handling Summary

| Scenario | HTTP | Response |
|---|---|---|
| Validation failure | 400 | `{ message: "..." }` |
| Invalid serviceIds | 400 | `{ message: "One or more selected services are invalid." }` |
| Date is holiday | 400 | `{ message: "The selected date is a holiday." }` |
| Slot full at check | 409 | `{ message: "This time slot is fully booked. Please choose another." }` |
| Token not found | 404 | `{ message: "Booking not found." }` |
| Rate limit exceeded | 429 | `{ message: "Too many booking attempts..." }` |
| Email send failure | Silent (logged, booking already saved) | |

---

## 11. Out of Scope

- Email OTP verification for guest bookings (email legitimacy enforced by rate limit only)
- Guest booking cancellation by the guest themselves
- Pagination on `GET /api/public/track/:token` (single booking only)
