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
          appointment_date, appointment_time, notes, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
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
         (appointment_date, appointment_time, max_capacity, current_bookings, is_available, updated_at)
       VALUES (?, ?, 3, 1, 1, NOW())
       ON DUPLICATE KEY UPDATE
         current_bookings = current_bookings + 1,
         is_available = IF(current_bookings + 1 >= max_capacity, 0, 1),
         updated_at = NOW()`,
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
     LIMIT ${limit} OFFSET ${offset}`,
    params
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
         is_available = IF(current_bookings >= ?, 0, 1),
         updated_at = NOW()
     WHERE slot_id = ?`,
    [maxCapacity, maxCapacity, slotId]
  );
}
