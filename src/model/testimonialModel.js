// testimonialModel.js — Privacy-safe testimonials
import { db } from '../config/db.js';

function generateInitials(firstName, lastName, sex) {
  const firstInitial = (firstName || '').charAt(0).toUpperCase();
  const lastInitial = (lastName || '').charAt(0).toUpperCase();
  const prefix = (sex || '').toLowerCase() === 'female' ? 'Ms.' : 'Mr.';
  return `${prefix} ${firstInitial}.${lastInitial}.`;
}

export async function createTestimonialModel(userId, transactionId, rating, message) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Verify transaction is in 'claimed' status and belongs to this user
    const [txRows] = await connection.execute(
      `SELECT dpt.transaction_id, dpt.client_id, s.status_name
       FROM document_process_transaction dpt
       INNER JOIN status s ON dpt.current_status_id = s.status_id
       WHERE dpt.transaction_id = ? AND dpt.client_id = ? AND s.status_name = 'claimed'`,
      [transactionId, userId]
    );

    if (!txRows.length) {
      await connection.rollback();
      return { error: 'Transaction not found or not yet claimed' };
    }

    // Check if testimonial already exists for this transaction
    const [existing] = await connection.execute(
      `SELECT testimonial_id FROM testimonials WHERE transaction_id = ?`,
      [transactionId]
    );
    if (existing.length > 0) {
      await connection.rollback();
      return { error: 'You have already left a testimonial for this transaction' };
    }

    // Get user info for initials (NEVER store full name)
    const [userRows] = await connection.execute(
      `SELECT first_name, last_name, sex FROM users WHERE id = ?`,
      [userId]
    );
    const user = userRows[0];
    const initials = generateInitials(user.first_name, user.last_name, user.sex);

    const [result] = await connection.execute(
      `INSERT INTO testimonials (transaction_id, user_id, initials, sex, rating, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [transactionId, userId, initials, user.sex || null, rating, message]
    );

    await connection.commit();
    return { testimonial_id: result.insertId, initials };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getPublicTestimonialsModel(limit = 20) {
  const [rows] = await db.execute(
    `SELECT
       t.testimonial_id,
       t.initials,
       t.rating,
       t.message,
       t.created_at,
       s.service_name
     FROM testimonials t
     INNER JOIN document_process_transaction dpt ON t.transaction_id = dpt.transaction_id
     INNER JOIN services s ON dpt.service_id = s.service_id
     WHERE t.is_visible = 1
     ORDER BY t.created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

export async function getTestimonialByTransactionModel(transactionId, userId) {
  const [rows] = await db.execute(
    `SELECT testimonial_id, initials, rating, message, created_at
     FROM testimonials
     WHERE transaction_id = ? AND user_id = ?`,
    [transactionId, userId]
  );
  return rows[0] || null;
}

export async function getAllTestimonialsAdminModel() {
  const [rows] = await db.execute(
    `SELECT
       t.testimonial_id,
       t.initials,
       t.rating,
       t.message,
       t.is_visible,
       t.created_at,
       s.service_name,
       dpt.transaction_id
     FROM testimonials t
     INNER JOIN document_process_transaction dpt ON t.transaction_id = dpt.transaction_id
     INNER JOIN services s ON dpt.service_id = s.service_id
     ORDER BY t.created_at DESC`
  );
  return rows;
}

export async function getMyTestimonialsModel(userId) {
  const [rows] = await db.execute(
    `SELECT
       t.testimonial_id,
       t.rating,
       t.message,
       t.is_visible,
       t.created_at,
       s.service_name,
       dpt.transaction_id
     FROM testimonials t
     INNER JOIN document_process_transaction dpt ON t.transaction_id = dpt.transaction_id
     INNER JOIN services s ON dpt.service_id = s.service_id
     WHERE t.user_id = ?
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows;
}

