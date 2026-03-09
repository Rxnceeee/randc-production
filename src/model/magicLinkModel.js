import { db } from '../config/db.js';
import crypto  from 'crypto';

export function hashMagicToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function saveMagicTokenModel(userId, rawToken, expiresAt) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE magic_link_tokens SET used = 1 WHERE user_id = ? AND used = 0`,
      [userId]
    );
    await conn.query(
      `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [userId, hashMagicToken(rawToken), expiresAt]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function findValidMagicTokenModel(rawToken) {
  const hash   = hashMagicToken(rawToken);
  const [rows] = await db.query(
    `SELECT id, user_id, expires_at
     FROM magic_link_tokens
     WHERE token_hash = ? AND used = 0 AND expires_at > NOW()
     LIMIT 1`,
    [hash]
  );
  return rows.length ? rows[0] : null;
}

export async function consumeMagicTokenModel(tokenId) {
  await db.query(`UPDATE magic_link_tokens SET used = 1 WHERE id = ?`, [tokenId]);
}

export async function countRecentMagicTokensModel(userId, windowMinutes = 10) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM magic_link_tokens
     WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [userId, windowMinutes]
  );
  return Number(rows[0].cnt);
}