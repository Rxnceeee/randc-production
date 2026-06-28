import {db} from '../config/db.js'

export async function getAllUsersModel(role) {
    const whereClause = role === 'all' ? `WHERE role not in ('admin') AND is_verified=1` : `WHERE role = '${role}' AND is_verified=1`;
    const query = `SELECT 
      CASE 
        WHEN last_name IS NOT NULL AND first_name IS NOT NULL
        THEN CONCAT(last_name, ', ', first_name, IF(middle_name IS NOT NULL, CONCAT(' ', middle_name), ''))
        ELSE COALESCE(username, email, 'Unknown')
      END AS full_name,
      id, username, email, role, is_active, is_verified,
      is_banned, ban_type,
      DATE_FORMAT(ban_until, '%Y-%m-%d') AS ban_until
    FROM users ${whereClause}
    ORDER BY created_at DESC`;

    const [result] = await db.query(query)
    return result;
}

export async function searchUsersByNameModel(searchTerm) {
  const query = `
    SELECT 
      CONCAT(last_name, ', ', first_name, ' ', IFNULL(middle_name, '')) AS full_name,
      id,
      username,
      email,
      role,
      is_active,
      is_verified
    FROM users
    WHERE 
      last_name LIKE ?
      OR first_name LIKE ?
      OR email LIKE ?
      OR middle_name LIKE ?
      OR CONCAT(first_name, ' ', last_name) LIKE ?
      OR CONCAT(last_name, ', ', first_name) LIKE ?
  `;

  const keyword = `%${searchTerm}%`;

  const [result] = await db.query(query, [
    keyword,
    keyword,
    keyword,
    keyword,
    keyword,
    keyword
  ]);

  return result;
}
