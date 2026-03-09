// walkInModel.js — Walk-in & penalty logic
import { db } from '../config/db.js';

const CLAIM_DAYS = 7;
const PENALTY_AMOUNT = 200.00;

// ── CREATE WALK-IN TRANSACTION ────────────────────────────────
export async function createWalkInTransactionModel(adminId, clientId, serviceId, notes = '') {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Verify client exists and has role=client
    const [clientRows] = await connection.execute(
      `SELECT id, first_name, last_name, email FROM users
       WHERE id = ? AND role = 'client' AND deleted_at IS NULL`,
      [clientId]
    );
    if (!clientRows.length) {
      await connection.rollback();
      return { error: 'Client not found or invalid' };
    }

    // Status 6 = pending (walk-in starts as pending)
    const [txResult] = await connection.execute(
      `INSERT INTO document_process_transaction
         (client_id, service_id,created_by, current_status_id, transaction_type)
       VALUES (?, ?, ?,6, 'walk_in')`,
      [clientId, serviceId, adminId]
    );
    const transactionId = txResult.insertId;

    // Log initial timestamp
    await connection.execute(
      `INSERT INTO document_process_transaction_timestamp
         (transaction_id, status_id, changed_by, remarks)
       VALUES (?, 6, ?, 'Walk-in transaction created by admin')`,
      [transactionId, adminId]
    );

    // Create notification for client
    await connection.execute(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       VALUES (?, 'walk_in_created', 'Walk-In Transaction Created',
               'A walk-in transaction has been created for you by the office.', ?)`,
      [clientId, transactionId]
    );

    await connection.commit();
    return { transactionId, client: clientRows[0] };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ── SEARCH CLIENT FOR WALK-IN ─────────────────────────────────
export async function searchClientForWalkInModel(searchTerm) {
  const keyword = `%${searchTerm}%`;
  const [rows] = await db.execute(
    `SELECT id, first_name, last_name, middle_name, email, phone_number, username
     FROM users
     WHERE role = 'client'
       AND is_verified = 1
       AND deleted_at IS NULL
       AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
            OR username LIKE ? OR phone_number LIKE ?
            OR CONCAT(first_name, ' ', last_name) LIKE ?)
     LIMIT 10`,
    [keyword, keyword, keyword, keyword, keyword, keyword]
  );
  return rows;
}

// ── SET READY DATE + CLAIM DEADLINE ──────────────────────────
export async function setReadyDateModel(transactionId, adminId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const readyDate = new Date();
    const claimDeadline = new Date(readyDate.getTime() + CLAIM_DAYS * 24 * 60 * 60 * 1000);

    await connection.execute(
      `UPDATE document_process_transaction
       SET ready_date = ?, claim_deadline = ?, current_status_id = 4
       WHERE transaction_id = ?`,
      [readyDate, claimDeadline, transactionId]
    );

    // Log status change
    await connection.execute(
      `INSERT INTO document_process_transaction_timestamp
         (transaction_id, status_id, changed_by, remarks)
       VALUES (?, 4, ?, 'Document ready to claim')`,
      [transactionId, adminId]
    );

    // Get client info for notification
    const [txRows] = await connection.execute(
      `SELECT dpt.client_id, s.service_name, u.email
       FROM document_process_transaction dpt
       INNER JOIN services s ON dpt.service_id = s.service_id
       INNER JOIN users u ON dpt.client_id = u.id
       WHERE dpt.transaction_id = ?`,
      [transactionId]
    );

    if (txRows.length) {
      const { client_id, service_name } = txRows[0];

      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, related_id)
         VALUES (?, 'status_update',
                 'Document Ready to Claim',
                 ?, ?)`,
        [
          client_id,
          `Your ${service_name} is ready. Claim by ${claimDeadline.toLocaleDateString('en-PH')} to avoid a ₱${PENALTY_AMOUNT} penalty fee.`,
          transactionId
        ]
      );
    }

    await connection.commit();
    return { readyDate, claimDeadline, clientInfo: txRows[0] || null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ── CHECK AND APPLY PENALTIES ─────────────────────────────────
export async function applyExpiredClaimPenaltiesModel() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Find all to_claim transactions past their deadline
    const [expired] = await connection.execute(
      `SELECT dpt.transaction_id, dpt.client_id, s.service_name
       FROM document_process_transaction dpt
       INNER JOIN status st ON dpt.current_status_id = st.status_id
       INNER JOIN services s ON dpt.service_id = s.service_id
       WHERE st.status_name = 'to_claim'
         AND dpt.claim_deadline < NOW()
         AND dpt.has_penalty = 0`,
      []
    );

    for (const tx of expired) {
      await connection.execute(
        `UPDATE document_process_transaction
         SET penalty_amount = ?, has_penalty = 1
         WHERE transaction_id = ?`,
        [PENALTY_AMOUNT, tx.transaction_id]
      );

      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, related_id)
         VALUES (?, 'penalty_notice',
                 'Penalty Fee Applied',
                 ?, ?)`,
        [
          tx.client_id,
          `A ₱${PENALTY_AMOUNT} penalty fee has been applied to your ${tx.service_name} transaction for not claiming within 7 days.`,
          tx.transaction_id
        ]
      );
    }

    await connection.commit();
    return expired.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getWalkinDocumentTransactionsByStatusModel(status) {
  try {
    let query = `
      SELECT 
        dpt.transaction_id,
        dpt.client_id,
        dpt.service_id,
        dpt.current_status_id,
        dpt.created_at,
        dpt.updated_at,
        u.first_name,
        u.last_name,
        u.email,
        u.phone_number,
        s.service_name,
        s.description as service_description,
        st.status_name,
        st.description as status_description
      FROM document_process_transaction dpt
      INNER JOIN users u ON dpt.client_id = u.id
      INNER JOIN services s ON dpt.service_id = s.service_id
      INNER JOIN status st ON dpt.current_status_id = st.status_id
    `;

    if (status && status !== 'all') {
      query += ` WHERE st.status_name = ?`;
      const [rows] = await db.execute(query, [status]);
      return rows;
    }

    const [rows] = await db.execute(query);
    return rows;
  } catch (error) {
    throw error;
  }
}