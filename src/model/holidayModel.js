// src/model/holidayModel.js
import { db } from '../config/db.js';

export async function isHolidayDate(dateStr) {
  const [rows] = await db.execute(
    `SELECT holiday_name, holiday_type
     FROM holidays
     WHERE is_active = 1
       AND (
            -- Exact one-time or variable date
            (holiday_date IS NOT NULL AND holiday_date = ?)
            OR
            -- Recurring: same month & day regardless of year
            (is_recurring = 1 AND month = MONTH(?) AND day = DAY(?))
           )
     LIMIT 1`,
    [dateStr, dateStr, dateStr]
  );

  if (rows.length === 0) return { isHoliday: false };

  return {
    isHoliday:   true,
    holidayName: rows[0].holiday_name,
    type:        rows[0].holiday_type,
  };
}

export async function getAllHolidaysModel() {
  const [rows] = await db.execute(
    `SELECT
       holiday_id,
       holiday_name,
       holiday_date,
       month,
       day,
       is_recurring,
       holiday_type,
       description,
       is_active,
       created_at,
       updated_at
     FROM holidays
     ORDER BY
       CASE holiday_type
         WHEN 'regular' THEN 1
         WHEN 'special' THEN 2
         ELSE 3
       END,
       IF(is_recurring = 1, month * 100 + day, 9999),
       holiday_date ASC`
  );
  return rows;
}

export async function getHolidaysInRangeModel(startDate, endDate) {
  // We generate a list of dates in the range and match against both
  // exact dates and recurring month/day pairs.
  const [rows] = await db.execute(
    `SELECT
       h.holiday_id,
       h.holiday_name,
       h.holiday_type,
       h.description,
       -- For recurring: construct the date for the year of startDate
       CASE
         WHEN h.holiday_date IS NOT NULL THEN h.holiday_date
         ELSE DATE(CONCAT(YEAR(?), '-', LPAD(h.month, 2, '0'), '-', LPAD(h.day, 2, '0')))
       END AS resolved_date
     FROM holidays h
     WHERE h.is_active = 1
       AND (
             -- Exact date in range
             (h.holiday_date IS NOT NULL
              AND h.holiday_date BETWEEN ? AND ?)
             OR
             -- Recurring: month/day falls inside the range (same year as startDate)
             (h.is_recurring = 1
              AND DATE(CONCAT(YEAR(?), '-', LPAD(h.month, 2, '0'), '-', LPAD(h.day, 2, '0')))
                  BETWEEN ? AND ?)
           )
     ORDER BY resolved_date ASC`,
    [startDate,  startDate, endDate,  startDate,  startDate, endDate]
  );
  return rows;
}

export async function createHolidayModel(data, createdBy) {
  const { holidayName, holidayDate, month, day, isRecurring, holidayType, description } = data;

  const [result] = await db.execute(
    `INSERT INTO holidays
       (holiday_name, holiday_date, month, day, is_recurring, holiday_type, description, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      holidayName,
      holidayDate  || null,
      month        || null,
      day          || null,
      isRecurring  ? 1 : 0,
      holidayType  || 'custom',
      description  || null,
      createdBy,
    ]
  );

  return result.insertId;
}

export async function updateHolidayModel(holidayId, data) {
  const { holidayName, holidayDate, month, day, isRecurring, holidayType, description, isActive } = data;

  const [result] = await db.execute(
    `UPDATE holidays SET
       holiday_name  = ?,
       holiday_date  = ?,
       month         = ?,
       day           = ?,
       is_recurring  = ?,
       holiday_type  = ?,
       description   = ?,
       is_active     = ?,
       updated_at    = CURRENT_TIMESTAMP
     WHERE holiday_id = ?`,
    [
      holidayName,
      holidayDate  ?? null,
      month        ?? null,
      day          ?? null,
      isRecurring  ? 1 : 0,
      holidayType  || 'custom',
      description  || null,
      isActive !== undefined ? (isActive ? 1 : 0) : 1,
      holidayId,
    ]
  );

  return result.affectedRows;
}

export async function toggleHolidayActiveModel(holidayId, isActive) {
  const [result] = await db.execute(
    `UPDATE holidays SET is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE holiday_id = ?`,
    [isActive ? 1 : 0, holidayId]
  );
  return result.affectedRows;
}

export async function deleteHolidayModel(holidayId) {
  const [result] = await db.execute(
    `DELETE FROM holidays WHERE holiday_id = ? AND holiday_type = 'custom'`,
    [holidayId]
  );
  return result.affectedRows;
}

export async function getHolidayByIdModel(holidayId) {
  const [rows] = await db.execute(
    `SELECT * FROM holidays WHERE holiday_id = ? LIMIT 1`,
    [holidayId]
  );
  return rows[0] || null;
}

export async function getClosedDatesForCalendarModel(months = 3) {
  const today   = new Date();
  const endDate = new Date(today);
  endDate.setMonth(endDate.getMonth() + months);

  const startStr = today.toISOString().split('T')[0];
  const endStr   = endDate.toISOString().split('T')[0];

  const [rows] = await db.execute(
    `SELECT
       h.holiday_id,
       h.holiday_name,
       h.holiday_type,
       CASE
         WHEN h.holiday_date IS NOT NULL THEN DATE_FORMAT(h.holiday_date, '%Y-%m-%d')
         ELSE DATE_FORMAT(
               DATE(CONCAT(YEAR(CURDATE()), '-',
                    LPAD(h.month, 2, '0'), '-',
                    LPAD(h.day, 2, '0'))),
               '%Y-%m-%d')
       END AS resolved_date
     FROM holidays h
     WHERE h.is_active = 1
       AND (
             (h.holiday_date IS NOT NULL AND h.holiday_date BETWEEN ? AND ?)
             OR
             (h.is_recurring = 1
              AND DATE(CONCAT(YEAR(CURDATE()), '-', LPAD(h.month, 2, '0'), '-', LPAD(h.day, 2, '0')))
                  BETWEEN ? AND ?)
           )
     ORDER BY resolved_date ASC`,
    [startStr, endStr, startStr, endStr]
  );

  return rows;
}
