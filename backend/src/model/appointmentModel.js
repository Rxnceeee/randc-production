
import {db} from "../config/db.js";

export async function getAppointmentByIdModel(appointmentId) {
  try {
    const query = `
      SELECT 
        a.appointment_id,
        a.client_id,
        a.appointment_date,
        a.appointment_time,
        a.notes,
        a.status,
        a.remarks,
        u.first_name,
        u.last_name,
        u.email,
        u.phone_number
      FROM appointments a
      INNER JOIN users u ON a.client_id = u.id
      WHERE a.appointment_id = ?
    `;
    
    const [rows] = await db.execute(query, [appointmentId]);
    return rows[0];
  } catch (error) {
    throw error;
  }
}

export async function getAppointmentServicesModel(appointmentId) {
  try {
    const query = `
      SELECT 
        s.service_id,
        s.service_name,
        s.description
      FROM appointment_service aps
      INNER JOIN services s ON aps.service_id = s.service_id
      WHERE aps.appointment_id = ?
    `;
    
    const [rows] = await db.execute(query, [appointmentId]);
    return rows;
  } catch (error) {
    throw error;
  }
}

export async function getAllActiveServicesModel() {
  try {
    const query = `
      SELECT service_id, service_name, description
      FROM services
      WHERE is_active = 1
      ORDER BY service_name ASC
    `;
    
    const [rows] = await db.execute(query);
    return rows;
  } catch (error) {
    throw error;
  }
}

export async function completeAppointmentWithTransactionsModel(appointmentId, selectedServiceIds, completedBy, remarks) {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // 1. Get appointment details
    const [appointmentRows] = await connection.execute(
      `SELECT client_id FROM appointments WHERE appointment_id = ?`,
      [appointmentId]
    );

    if (appointmentRows.length === 0) {
      throw new Error('Appointment not found');
    }

    const clientId = appointmentRows[0].client_id;

    // 2. Update appointment status to 'completed'
    await connection.execute(
      `UPDATE appointments 
       SET status = 'completed', 
           remarks = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE appointment_id = ?`,
      [remarks, appointmentId]
    );

    const [statusRows] = await connection.execute(
      `SELECT status_id FROM status WHERE status_name = 'pending' LIMIT 1`
    );

    if (statusRows.length === 0) {
      throw new Error('Default status not found. Please create a "submitted" status.');
    }

    const submittedStatusId = statusRows[0].status_id;

    // 4. Create document transactions for each selected service
    const transactionIds = [];

    for (const serviceId of selectedServiceIds) {
      // Insert into document_process_transaction
      const [transactionResult] = await connection.execute(
        `INSERT INTO document_process_transaction
         (client_id, service_id, current_status_id, created_by, updated_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [clientId, serviceId, submittedStatusId, completedBy]
      );

      const transactionId = transactionResult.insertId;
      transactionIds.push(transactionId);

      // Insert initial timestamp record
      await connection.execute(
        `INSERT INTO document_process_transaction_timestamp 
         (transaction_id, status_id, changed_by, remarks)
         VALUES (?, ?, ?, ?)`,
        [transactionId, submittedStatusId, completedBy, `Created from completed appointment #${appointmentId}`]
      );

      // Create notification for client
      await connection.execute(
        `INSERT INTO notifications 
         (user_id, type, title, message, related_id)
         VALUES (?, 'status_update', ?, ?, ?)`,
        [
          clientId,
          'Document Process Created',
          `Your document processing for service has been initiated from your completed appointment.`,
          transactionId
        ]
      );
    }

    await connection.commit();

    return {
      success: true,
      transactionIds,
      clientId,
      appointmentId
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function searchAppointmentsModel(searchTerm, status) {
    try {
        const likeTerm = `%${searchTerm}%`;
        const params   = [likeTerm, likeTerm, likeTerm, likeTerm, likeTerm];

        let query = `
            SELECT 
                a.appointment_id,
                a.appointment_date,
                a.appointment_time,
                a.status,
                a.notes,
                a.created_at,
                u.email,
                CONCAT(u.first_name, ' ', u.last_name) AS client_name,
                COALESCE(
                    NULLIF(GROUP_CONCAT(DISTINCT s.service_name ORDER BY s.service_name SEPARATOR '|||'), ''),
                    ''
                ) AS services
            FROM appointments a
            JOIN users u ON a.client_id = u.id
            LEFT JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
            LEFT JOIN services s ON aps.service_id = s.service_id
            WHERE (
                CONCAT(u.first_name, ' ', u.last_name) LIKE ?
                OR CONCAT(u.last_name, ', ', u.first_name) LIKE ?
                OR DATE_FORMAT(a.appointment_date, '%Y-%m-%d') LIKE ?
                OR DATE_FORMAT(a.appointment_date, '%M %d, %Y') LIKE ?
                OR a.status LIKE ?
            )
        `;

        if (status === 'today') {
            query += ` AND DATE(a.appointment_date) = CURDATE()`;
        } else if (status !== 'all') {
            query += ` AND a.status = ?`;
            params.push(status);
        }

        query += ` GROUP BY 
                        a.appointment_id,
                        a.appointment_date,
                        a.appointment_time,
                        a.status,
                        a.notes,
                        a.created_at,
                        u.email,
                        u.first_name,
                        u.last_name
                   ORDER BY a.appointment_date DESC`;

        const [rows] = await db.query(query, params);

        return rows.map(row => ({
            ...row,
            services: row.services
                ? row.services.split('|||').filter(s => s.trim() !== '')
                : []
        }));

    } catch (error) {
        throw error;
    }
} 