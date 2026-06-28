import {db} from '../config/db.js';

export async function insertAuditLogsModel({
  actor_id = null,
  actor_role = 'System',
  target_id = null,
  action,
  details,
  category
}) {
  const query = `
    INSERT INTO audit_logs
      (actor_id, actor_role, target_id, action, details, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  const values = [actor_id, actor_role, target_id, action, details, category];

  try {
    await db.execute(query, values);
    return { success: true };
  } catch (err) {
    console.error('Error inserting audit log:', err);
    throw err;
  }
}

// GET ALL LOGS
export async function getAllAuditLogsModel() {
  const [rows] = await db.query(`
    SELECT
      al.id,
      al.actor_id,
      al.actor_role,
      al.target_id,
      al.action,
      al.details,
      al.category,
      al.ip_address,
      al.user_agent,
      al.created_at,
      CONCAT(actor.first_name, ' ', actor.last_name) AS actor_name,
      actor.email                                    AS actor_email,
      CONCAT(target.first_name, ' ', target.last_name) AS target_name,
      target.email                                   AS target_email
    FROM audit_logs al
    LEFT JOIN users actor  ON al.actor_id  = actor.id
    LEFT JOIN users target ON al.target_id = target.id
    ORDER BY al.created_at DESC
    LIMIT 500
  `);
  return rows;
}

// FILTER LOGS
export async function filterAuditLogsModel(params = {}) {
  let query = `
    SELECT
      al.id,
      al.actor_id,
      al.actor_role,
      al.target_id,
      al.action,
      al.details,
      al.category,
      al.ip_address,
      al.user_agent,
      al.created_at,
      CONCAT(actor.first_name, ' ', actor.last_name) AS actor_name,
      actor.email                                    AS actor_email,
      CONCAT(target.first_name, ' ', target.last_name) AS target_name,
      target.email                                   AS target_email
    FROM audit_logs al
    LEFT JOIN users actor  ON al.actor_id  = actor.id
    LEFT JOIN users target ON al.target_id = target.id
    WHERE 1=1
  `;

  const values = [];

  if (params.actor_role) {
    query += ` AND al.actor_role = ?`;
    values.push(params.actor_role);
  }

  if (params.category) {
    query += ` AND al.category = ?`;
    values.push(params.category);
  }

  if (params.target_id) {
    query += ` AND al.target_id = ?`;
    values.push(params.target_id);
  }

  if (params.start_date && params.end_date) {
    query += ` AND al.created_at BETWEEN ? AND ?`;
    values.push(params.start_date, params.end_date);
  }

  if (params.search) {
    query += ` AND (al.action LIKE ? OR al.details LIKE ? OR actor.email LIKE ?)`;
    const like = `%${params.search}%`;
    values.push(like, like, like);
  }

  query += ` ORDER BY al.created_at DESC LIMIT 500`;

  const [rows] = await db.query(query, values);
  return rows;
}
