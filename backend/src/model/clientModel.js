import { db } from '../config/db.js';

export async function setupUser(firstName, lastName, middleName, sex, userId) {
  const query = `UPDATE users SET first_name = ?, last_name = ?, middle_name = ?, sex = ? WHERE id = ?`;

  const [result] = await db.query(query, [firstName, lastName, middleName, sex, userId]);
  return result.affectedRows === 1;
}

// APPOINTMENTS
export async function getAvailableTimeSlotsModel(date) {
  const query = `
    SELECT 
      appointment_time,
      max_capacity,
      current_bookings,
      is_available,
      (max_capacity - current_bookings) as spots_left
    FROM appointment_time_slots
    WHERE appointment_date = ?
      AND is_available = TRUE
      AND (max_capacity - current_bookings) > 0
    ORDER BY appointment_time ASC
  `;
  
  const [slots] = await db.query(query, [date]);
  return slots;
}

export async function createDefaultTimeSlotsModel(date) {
  const defaultTimes = [
    '08:00:00','09:00:00', '10:00:00', '11:00:00',
    '13:00:00', '14:00:00', '15:00:00', '16:00:00'
  ];

  const query = `
    INSERT IGNORE INTO appointment_time_slots 
    (appointment_date, appointment_time, max_capacity, current_bookings, is_available)
    VALUES (?, ?, 3, 0, TRUE)
  `;

  for (const time of defaultTimes) {
    await db.query(query, [date, time]);
  }
}
//
export async function checkTimeSlotAvailabilityModel( date, time) {
  const query = `
    SELECT max_capacity, current_bookings 
    FROM appointment_time_slots 
    WHERE appointment_date = ? AND appointment_time = ? 
    FOR UPDATE
  `;
  
  const [result] = await db.query(query, [date, time]);
  return result.length > 0 ? result[0] : null;
}

export async function createTimeSlotModel( date, time) {
  const query = `
    INSERT INTO appointment_time_slots 
    (appointment_date, appointment_time, max_capacity, current_bookings, is_available)
    VALUES (?, ?, 3, 0, TRUE)
  `;
  
  await db.query(query, [date, time]);
}

export async function incrementTimeSlotBookingModel( date, time) {
  const query = `
    UPDATE appointment_time_slots 
    SET current_bookings = current_bookings + 1,
        updated_at = NOW()
    WHERE appointment_date = ? AND appointment_time = ?
  `;
  
  const [result] = await db.query(query, [date, time]);
  return result.affectedRows;
}

export async function decrementTimeSlotBookingModel( date, time) {
  const query = `
    UPDATE appointment_time_slots 
    SET current_bookings = GREATEST(current_bookings - 1, 0),
        updated_at = NOW()
    WHERE appointment_date = ? AND appointment_time = ?
  `;
  
  const [result] = await db.query(query, [date, time]);
  return result.affectedRows;
}

// NOTIFICATION FUNCTIONS

export async function getUserNotificationsModel(userId) {
  const query = `
    SELECT 
      notification_id,
      type,
      title,
      message,
      related_id,
      is_read,
      created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `;
  
  const [notifications] = await db.query(query, [userId]);
  return notifications;
}

export async function markNotificationAsReadModel(notificationId, userId) {
  const query = `
    UPDATE notifications 
    SET is_read = TRUE 
    WHERE notification_id = ? AND user_id = ?
  `;
  
  const [result] = await db.query(query, [notificationId, userId]);
  return result.affectedRows;
}

export async function markAllNotificationsAsReadModel(userId) {
  const query = `
    UPDATE notifications 
    SET is_read = TRUE 
    WHERE user_id = ? AND is_read = FALSE
  `;
  
  const [result] = await db.query(query, [userId]);
  return result.affectedRows;
}

export async function getUnreadNotificationCountModel(userId) {
  const query = `
    SELECT COUNT(*) as unread_count
    FROM notifications
    WHERE user_id = ? AND is_read = FALSE
  `;
  
  const [result] = await db.query(query, [userId]);
  return result[0].unread_count;
}

export async function updateUserPasswordModel(userId, hashedPassword) {
  const query = `
    UPDATE users 
    SET password = ?, updated_at = NOW() 
    WHERE id = ?
  `;
  
  const [result] = await db.query(query, [hashedPassword, userId]);
  return result.affectedRows;
} 