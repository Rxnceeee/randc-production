import { db } from '../config/db.js';

export async function getUserCridentials(usernameOrEmail) {
  const query = `
    SELECT id, password, role, is_verified,
           login_attempts, login_cooldown_until,
           is_banned, ban_type, ban_until,
           otp_attempts, otp_lock_until,
           deleted_at
    FROM users WHERE username = ? OR email = ? LIMIT 1`;
  const [rows] = await db.query(query, [usernameOrEmail, usernameOrEmail]);
  return rows.length ? rows[0] : null;
}

export async function verifyEmail(email) {
  const query = 'SELECT * FROM users WHERE email = ? AND is_verified = 1 LIMIT 1';
  const [rows] = await db.query(query, [email]);
  return rows.length > 0;
}

export async function verifyUsername(username) {
  const query = 'SELECT * FROM users WHERE username = ? LIMIT 1';
  const [rows] = await db.query(query, [username]);
  return rows.length > 0;
}

export async function saveUser(username, hashedPassword, email) {
  const role = 'client';
  const query = `INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)`;
  const [result] = await db.query(query, [username, hashedPassword, email, role]);
  return result.insertId;
}

export async function getUserById(userId) {
  const query = `
    SELECT id, username, email, role,
           last_name, first_name, middle_name, sex, picture,
           is_banned, ban_type, ban_until, deleted_at, is_verified, created_at
    FROM users WHERE id = ?`;
  const [rows] = await db.query(query, [userId]);
  return rows[0];
}

export async function getUserByEmail(email) {
  const query = `SELECT id FROM users WHERE email = ?`;
  const [rows] = await db.query(query, [email]);
  return rows[0]?.id;
}

// OTP
export async function saveOTP(userId, hashed, expiresAt) {
  const query = `UPDATE users SET verification_code = ?, code_expires_at = ? WHERE id = ?`;
  const [result] = await db.query(query, [hashed, expiresAt, userId]);
  return result.affectedRows === 1;
}

export async function getOTP(userId) {
  const query = `
    SELECT verification_code, code_expires_at, otp_attempts, otp_lock_until
    FROM users WHERE id = ?`;
  const [result] = await db.query(query, [userId]);
  return result;
}

export async function verifyAccountStatus(userId) {
  const query = 'UPDATE users SET is_verified = 1 WHERE id = ?';
  await db.query(query, [userId]);
}

export async function clearOTP(userId) {
  const query = `
    UPDATE users
    SET verification_code = NULL, code_expires_at = NULL,
        otp_attempts = 0, otp_lock_until = NULL
    WHERE id = ?`;
  await db.query(query, [userId]);
}

// OTP ANTI-SPAM
export async function incrementOtpAttempts(userId) {
  await db.query(
    `UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?`,
    [userId]
  );
}

export async function setOtpLock(userId, lockUntil) {
  await db.query(
    `UPDATE users SET otp_lock_until = ?, otp_attempts = 0 WHERE id = ?`,
    [lockUntil, userId]
  );
}

// LOGIN SECURITY
export async function incrementLoginAttempts(userId) {
  await db.query(
    `UPDATE users
     SET login_attempts = login_attempts + 1, login_last_attempt = NOW()
     WHERE id = ?`,
    [userId]
  );
}

export async function setLoginCooldown(userId, cooldownUntil) {
  await db.query(
    `UPDATE users
     SET login_cooldown_until = ?, login_attempts = 0
     WHERE id = ?`,
    [cooldownUntil, userId]
  );
}

export async function resetLoginAttempts(userId) {
  await db.query(
    `UPDATE users
     SET login_attempts = 0, login_cooldown_until = NULL, login_last_attempt = NULL
     WHERE id = ?`,
    [userId]
  );
}

// PASSWORD
export async function changeClientPassword(newPassword, userID) {
  const query = 'UPDATE users SET password = ? WHERE id = ?';
  const [result] = await db.query(query, [newPassword, userID]);
  return result;
}

// BAN MANAGEMENT
export async function banUserModel(userId, bannedBy, banType, banReason) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    let banUntil = null;
    if (banType === '3_days') {
      banUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    } else if (banType === '30_days') {
      banUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    // permanent = null ban_until

    // Deactivate previous active bans
    await connection.execute(
      `UPDATE user_bans SET is_active = 0 WHERE user_id = ? AND is_active = 1`,
      [userId]
    );

    // Insert new ban record
    await connection.execute(
      `INSERT INTO user_bans (user_id, banned_by, ban_type, ban_until, ban_reason, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [userId, bannedBy, banType, banUntil, banReason || '']
    );

    // Update user record
    await connection.execute(
      `UPDATE users
       SET is_banned = 1, ban_type = ?, ban_until = ?, ban_reason = ?
       WHERE id = ?`,
      [banType, banUntil, banReason || '', userId]
    );

    await connection.commit();
    return { banUntil };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function unbanUserModel(userId, liftedBy) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE user_bans SET is_active = 0, lifted_at = NOW(), lifted_by = ?
       WHERE user_id = ? AND is_active = 1`,
      [liftedBy, userId]
    );

    await connection.execute(
      `UPDATE users
       SET is_banned = 0, ban_type = NULL, ban_until = NULL, ban_reason = NULL
       WHERE id = ?`,
      [userId]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function checkActiveBanModel(userId) {
  const [rows] = await db.query(
    `SELECT is_banned, ban_type, ban_until
     FROM users WHERE id = ?`,
    [userId]
  );
  if (!rows.length) return null;
  const user = rows[0];

  if (!user.is_banned) return null;

  // Auto-lift expired temporary bans
  if (user.ban_until && new Date(user.ban_until) < new Date()) {
    await unbanUserModel(userId, null);
    return null;
  }

  return { ban_type: user.ban_type, ban_until: user.ban_until };
}

// ACCOUNT Anonymization
export async function anonymizationAccountModel(userId, ip = null, userAgent = null) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Deactivate account and mark deleted
    await connection.execute(
      `UPDATE users SET deleted_at = NOW(), is_active = 0 WHERE id = ?`,
      [userId]
    );

    // 2. Log the deletion request in account_deletion_requests
    await connection.execute(
      `INSERT INTO account_deletion_requests (user_id, status)
       VALUES (?, 'Approved')`,
      [userId]
    );

    // 3. Add audit log for client request
    await connection.execute(
      `INSERT INTO audit_logs(actor_id, actor_role, target_id, action, details, ip_address, user_agent, category)
       VALUES (?, 'Client', ?, 'Requested Account Anonymization','Client requested account anonymization, pending 7-day completion',?, ?, 'Anonymization')`,
      [userId, userId, ip, userAgent]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ACCOUNT reverse Anonymization
export async function reverseAnonymizationAccountModel(userId, ip = null, userAgent = null) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Reactivate account
    await connection.execute(
      `UPDATE users SET deleted_at = NULL, is_active = 1 WHERE id = ?`,
      [userId]
    );

    // 2. Update account_deletion_requests
    await connection.execute(
      `UPDATE account_deletion_requests
       SET status = 'Reactivated', processed_at = NOW()
       WHERE user_id = ?`,
      [userId]
    );

    // 3. Add audit log for client reactivation
    await connection.execute(
      `INSERT INTO audit_logs
        (actor_id, actor_role, target_id, action, details, ip_address, user_agent, category) 
        VALUES (?, 'Client', ?, 'Recovered Account','Client restored their account after anonymization',?, ?, 'Anonymization')`,
      [userId, userId, ip, userAgent]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function hasActiveTransactionsModel(userId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) as cnt FROM document_process_transaction dpt
     INNER JOIN status s ON dpt.current_status_id = s.status_id
     WHERE dpt.client_id = ?
       AND s.status_name NOT IN ('claimed', 'cancelled')`,
    [userId]
  );
  return rows[0].cnt > 0;
}

export async function hasActiveAppointmentsModel(userId) {
  const [rows] = await db.query(
    `SELECT COUNT(*) as cnt FROM appointments
     WHERE client_id = ? AND status IN ('pending', 'approved')`,
    [userId]
  );
  return rows[0].cnt > 0;
}

// GET ALL CLIENTS (Admin)
export async function getAllClientsModel(search = '') {
  const keyword = `%${search}%`;
  const [rows] = await db.query(
    `SELECT
       id, username, email, phone_number,
       first_name, last_name, middle_name, sex,
       is_verified, is_active, is_banned, ban_type, ban_until,
       created_at, last_login, deleted_at
     FROM users
     WHERE role = 'client'
       AND deleted_at IS NULL
       AND is_verified = 1
       AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR username LIKE ?)
     ORDER BY created_at DESC`,
    [keyword, keyword, keyword, keyword]
  );
  return rows;
}

export async function updateActiveStatus(id, is_active) {
  const query = `UPDATE users SET is_active = ?, last_seen = NOW() WHERE id = ?`;
  const [result] = await db.query(query, [is_active, id]);
  return result;
}
