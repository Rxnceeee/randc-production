import {db} from "../config/db.js";

export async function searchDocumentTransactionsByStatusModel(searchTerm,status) {
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
      WHERE (u.last_name LIKE ?
      OR u.first_name LIKE ?
      OR dpt.transaction_id LIKE ?
      OR u.email LIKE ?
      OR u.middle_name LIKE ?
      OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
      OR CONCAT(u.last_name, ', ', u.first_name) LIKE ?)
    `;

    const keyword = `%${searchTerm}%`;

  const params = [
    keyword,
    keyword,
    keyword,
    keyword,
    keyword,
    keyword,
    keyword
  ];

    if (status && status !== 'all') {
      query += ` AND st.status_name = ?`;
      params.push(status);
    }

    const [rows] = await db.execute(query, params);
    return rows;

  } catch (error) {
    throw error;
  }
}

export async function getDocumentTransactionsByStatusModel(status) {
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

export async function getWalikinDocumentTransactions(type = 'walk_in') {
  try {
    const query = `
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
      WHERE dpt.transaction_type = ?
    `;

    const [rows] = await db.execute(query, [type]);
    return rows;
  } catch (error) {
    throw error;
  }
}

export async function getTransactionByIdModel(transactionId) {
  try {
    const query = `
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
        st.status_name
      FROM document_process_transaction dpt
      INNER JOIN users u ON dpt.client_id = u.id
      INNER JOIN services s ON dpt.service_id = s.service_id
      INNER JOIN status st ON dpt.current_status_id = st.status_id
      WHERE dpt.transaction_id = ?
    `;
    
    const [rows] = await db.execute(query, [transactionId]);
    return rows[0];
  } catch (error) {
    throw error;
  }
}

export async function updateTransactionStatusModel(transactionId, statusId, changedBy, remarks, imagePaths) {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // Update current status in main transaction table
    const updateQuery = `
      UPDATE document_process_transaction 
      SET current_status_id = ?
      WHERE transaction_id = ?
    `;
    await connection.execute(updateQuery, [statusId, transactionId]);

    // Insert timestamp record
    const timestampQuery = `
      INSERT INTO document_process_transaction_timestamp 
      (transaction_id, status_id, changed_by, remarks)
      VALUES (?, ?, ?, ?)
    `;
    const [timestampResult] = await connection.execute(timestampQuery, [
      transactionId,
      statusId,
      changedBy,
      remarks
    ]);

    const timestampId = timestampResult.insertId;

    // Insert photos if any
    if (imagePaths && imagePaths.length > 0) {
      const photoQuery = `
        INSERT INTO document_process_transaction_timestamp_photo 
        (timestamp_id, file_path, file_name, file_size)
        VALUES (?, ?, ?, ?)
      `;

      for (const image of imagePaths) {
        await connection.execute(photoQuery, [
          timestampId,
          image.path,
          image.filename,
          image.size
        ]);
      }
    }

    await connection.commit();
    return { timestampId, success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getTransactionTimelineModel(transactionId) {
  try {
    const query = `
      SELECT 
        ts.timestamp_id,
        ts.transaction_id,
        ts.status_id,
        ts.changed_by,
        ts.remarks,
        ts.changed_at,
        st.status_name,
        st.description as status_description,
        u.first_name,
        u.last_name
      FROM document_process_transaction_timestamp ts
      INNER JOIN status st ON ts.status_id = st.status_id
      INNER JOIN users u ON ts.changed_by = u.id
      WHERE ts.transaction_id = ?
      ORDER BY ts.changed_at DESC
    `;
    
    const [rows] = await db.execute(query, [transactionId]);
    
    // Get photos for each timestamp
    for (let row of rows) {
      const photoQuery = `
        SELECT file_path, file_name, file_size
        FROM document_process_transaction_timestamp_photo
        WHERE timestamp_id = ?
      `;
      const [photos] = await db.execute(photoQuery, [row.timestamp_id]);
      row.photos = photos;
    }
    
    return rows;
  } catch (error) {
    throw error;
  }
}

export async function getAllStatusesModel() {
  try {
    const query = `SELECT status_id, status_name, description FROM status`;
    const [rows] = await db.execute(query);
    return rows;
  } catch (error) {
    throw error;
  }
}

export async function createNotificationModel( userId, type, title, message, relatedId = null) {
  const query = `
    INSERT INTO notifications 
    (user_id, type, title, message, related_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, FALSE, NOW())
  `;
  
  const [result] = await db.query(query, [userId, type, title, message, relatedId]);
  return result.insertId;
}

export async function getTransactionReportDataModel(transactionId) {
  try {
    // Get main transaction details
    const [transactionRows] = await db.execute(
      `SELECT 
        dpt.transaction_id,
        dpt.created_at as transaction_created_at,
        dpt.updated_at as transaction_updated_at,
        u.id as client_id,
        u.first_name,
        u.last_name,
        u.middle_name,
        u.email,
        u.phone_number,
        u.sex,
        s.service_id,
        s.service_name,
        s.description as service_description,
        st.status_id,
        st.status_name as current_status,
        st.description as status_description,
        creator.first_name as created_by_first_name,
        creator.last_name as created_by_last_name
      FROM document_process_transaction dpt
      INNER JOIN users u ON dpt.client_id = u.id
      INNER JOIN services s ON dpt.service_id = s.service_id
      INNER JOIN status st ON dpt.current_status_id = st.status_id
      LEFT JOIN users creator ON dpt.created_by = creator.id
      WHERE dpt.transaction_id = ?`,
      [transactionId]
    );

    if (transactionRows.length === 0) {
      return null;
    }

    const transaction = transactionRows[0];

    // Get complete timeline with photos
    const [timelineRows] = await db.execute(
      `SELECT 
        ts.timestamp_id,
        ts.remarks,
        ts.changed_at,
        st.status_name,
        st.description as status_description,
        u.first_name as changed_by_first_name,
        u.last_name as changed_by_last_name
      FROM document_process_transaction_timestamp ts
      INNER JOIN status st ON ts.status_id = st.status_id
      INNER JOIN users u ON ts.changed_by = u.id
      WHERE ts.transaction_id = ?
      ORDER BY ts.changed_at ASC`,
      [transactionId]
    );

    // Get photos for each timeline entry
    for (let timeline of timelineRows) {
      const [photoRows] = await db.execute(
        `SELECT file_path, file_name, file_size
        FROM document_process_transaction_timestamp_photo
        WHERE timestamp_id = ?`,
        [timeline.timestamp_id]
      );
      timeline.photos = photoRows;
    }

    // Get appointment details if transaction was created from appointment
    const [appointmentRows] = await db.execute(
      `SELECT 
        a.appointment_id,
        a.appointment_date,
        a.appointment_time,
        a.notes,
        a.created_at as appointment_created_at
      FROM appointments a
      INNER JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
      WHERE a.client_id = ? 
        AND aps.service_id = ?
        AND a.status = 'completed'
      ORDER BY a.created_at DESC
      LIMIT 1`,
      [transaction.client_id, transaction.service_id]
    );

    return {
      transaction,
      timeline: timelineRows,
      appointment: appointmentRows.length > 0 ? appointmentRows[0] : null
    };
  } catch (error) {
    throw error;
  }
}

//client document transaction
export async function getClientTransactionsByStatusModel(clientId, status = 'all') {
  try {
    let query = `
      SELECT 
        dpt.transaction_id,
        dpt.created_at,
        dpt.updated_at,
        s.service_name,
        s.description as service_description,
        st.status_name,
        st.description as status_description
      FROM document_process_transaction dpt
      INNER JOIN services s ON dpt.service_id = s.service_id
      INNER JOIN status st ON dpt.current_status_id = st.status_id
      WHERE dpt.client_id = ?
    `;

    const params = [clientId];

    if (status && status !== 'all') {
      query += ` AND st.status_name = ?`;
      params.push(status);
    }

    query += ` ORDER BY dpt.created_at DESC`;

    const [rows] = await db.execute(query, params);
    return rows;
  } catch (error) {
    throw error;
  }
}

export async function searchClientTransactionsModel(clientId, searchTerm, status = 'all') {
  try {
    let query = `
      SELECT 
        dpt.transaction_id,
        dpt.created_at,
        dpt.updated_at,
        s.service_name,
        s.description as service_description,
        st.status_name,
        st.description as status_description
      FROM document_process_transaction dpt
      INNER JOIN services s ON dpt.service_id = s.service_id
      INNER JOIN status st ON dpt.current_status_id = st.status_id
      WHERE dpt.client_id = ?
        AND (
          dpt.transaction_id LIKE ? OR
          s.service_name LIKE ? OR
          st.status_name LIKE ?
        )
    `;

    const searchPattern = `%${searchTerm}%`;
    const params = [clientId, searchPattern, searchPattern, searchPattern];

    if (status && status !== 'all') {
      query += ` AND st.status_name = ?`;
      params.push(status);
    }

    query += ` ORDER BY dpt.created_at DESC`;

    const [rows] = await db.execute(query, params);
    return rows;
  } catch (error) {
    throw error;
  }
}

export async function getClientTransactionTimelineModel(transactionId, clientId) {
  try {
    // Verify transaction belongs to client
    const [transactionCheck] = await db.execute(
      `SELECT transaction_id FROM document_process_transaction WHERE transaction_id = ? AND client_id = ?`,
      [transactionId, clientId]
    );

    if (transactionCheck.length === 0) {
      return null;
    }

    // Get timeline
    const [timelineRows] = await db.execute(
      `SELECT 
        ts.timestamp_id,
        ts.remarks,
        ts.changed_at,
        st.status_name,
        st.description as status_description,
        u.first_name as changed_by_first_name,
        u.last_name as changed_by_last_name
      FROM document_process_transaction_timestamp ts
      INNER JOIN status st ON ts.status_id = st.status_id
      INNER JOIN users u ON ts.changed_by = u.id
      WHERE ts.transaction_id = ?
      ORDER BY ts.changed_at DESC`,
      [transactionId]
    );

    // Get photos for each timeline entry
    for (let timeline of timelineRows) {
      const [photoRows] = await db.execute(
        `SELECT file_path, file_name, file_size
        FROM document_process_transaction_timestamp_photo
        WHERE timestamp_id = ?`,
        [timeline.timestamp_id]
      );
      timeline.photos = photoRows;
    }

    return timelineRows;
  } catch (error) {
    throw error;
  }
}

export async function cancelClientTransactionModel(transactionId, clientId, reason) {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // Verify transaction belongs to client and can be cancelled
    const [transactionRows] = await connection.execute(
      `SELECT dpt.transaction_id, st.status_name
       FROM document_process_transaction dpt
       INNER JOIN status st ON dpt.current_status_id = st.status_id
       WHERE dpt.transaction_id = ? AND dpt.client_id = ?`,
      [transactionId, clientId]
    );

    if (transactionRows.length === 0) {
      throw new Error('Transaction not found');
    }

    const currentStatus = transactionRows[0].status_name;

    // Check if transaction can be cancelled
    if (['claimed', 'completed', 'cancelled'].includes(currentStatus)) {
      throw new Error(`Cannot cancel transaction with status: ${currentStatus}`);
    }

    // Get cancelled status ID
    const [cancelledStatusRows] = await connection.execute(
      `SELECT status_id FROM status WHERE status_name = 'cancelled' LIMIT 1`
    );

    if (cancelledStatusRows.length === 0) {
      throw new Error('Cancelled status not found in system');
    }

    const cancelledStatusId = cancelledStatusRows[0].status_id;

    // Update transaction status
    await connection.execute(
      `UPDATE document_process_transaction 
       SET current_status_id = ?
       WHERE transaction_id = ?`,
      [cancelledStatusId, transactionId]
    );

    // Insert timeline record
    await connection.execute(
      `INSERT INTO document_process_transaction_timestamp 
       (transaction_id, status_id, changed_by, remarks)
       VALUES (?, ?, ?, ?)`,
      [transactionId, cancelledStatusId, clientId, `Cancelled by client. Reason: ${reason}`]
    );

    // Create notification for admin/staff
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, related_id)
       SELECT id, 'status_update', 'Transaction Cancelled by Client', ?, ?
       FROM users WHERE role IN ('admin', 'staff')`,
      [`Transaction #${transactionId} has been cancelled by the client.`, transactionId]
    );

    await connection.commit();
    return { success: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getClientTransactionReceiptModel(transactionId, clientId) {
  try {
    // Verify transaction belongs to client and is claimed
    const [transactionRows] = await db.execute(
      `SELECT 
        dpt.transaction_id,
        dpt.created_at as transaction_created_at,
        dpt.updated_at as transaction_updated_at,
        u.id as client_id,
        u.first_name,
        u.last_name,
        u.middle_name,
        u.email,
        u.phone_number,
        s.service_id,
        s.service_name,
        s.description as service_description,
        st.status_id,
        st.status_name as current_status,
        creator.first_name as processed_by_first_name,
        creator.last_name as processed_by_last_name
      FROM document_process_transaction dpt
      INNER JOIN users u ON dpt.client_id = u.id
      INNER JOIN services s ON dpt.service_id = s.service_id
      INNER JOIN status st ON dpt.current_status_id = st.status_id
      LEFT JOIN users creator ON dpt.created_by = creator.id
      WHERE dpt.transaction_id = ? 
        AND dpt.client_id = ?
        AND st.status_name IN ('claimed', 'completed')`,
      [transactionId, clientId]
    );

    if (transactionRows.length === 0) {
      return null; // Transaction not found or not claimed/completed
    }

    const transaction = transactionRows[0];

    // Get key timeline events (submitted, completed/claimed)
    const [timelineRows] = await db.execute(
      `SELECT 
        ts.changed_at,
        st.status_name
      FROM document_process_transaction_timestamp ts
      INNER JOIN status st ON ts.status_id = st.status_id
      WHERE ts.transaction_id = ?
        AND st.status_name IN ('submitted', 'claimed', 'completed', 'to_claim')
      ORDER BY ts.changed_at ASC`,
      [transactionId]
    );

    // Get appointment if exists
    const [appointmentRows] = await db.execute(
      `SELECT 
        a.appointment_id,
        a.appointment_date,
        a.appointment_time
      FROM appointments a
      INNER JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
      WHERE a.client_id = ? 
        AND aps.service_id = ?
        AND a.status = 'completed'
      ORDER BY a.created_at DESC
      LIMIT 1`,
      [transaction.client_id, transaction.service_id]
    );

    return {
      transaction,
      timeline: timelineRows,
      appointment: appointmentRows.length > 0 ? appointmentRows[0] : null
    };
  } catch (error) {
    throw error;
  }
}

//DASHBOARD CLIENT

export async function getDashboardStatsModel(userId) {
    try {
        // 1️⃣ Get this user's appointments
        const [appointments] = await db.query(
            `SELECT status 
             FROM appointments 
             WHERE client_id = ?`,
            [userId]
        );

        // 2️⃣ Get this user's transactions with their status
        const [transactions] = await db.query(
            `SELECT s.status_name
             FROM document_process_transaction t
             JOIN status s ON t.current_status_id = s.status_id
             WHERE t.client_id = ?`,
            [userId]
        );

        // 3️⃣ Initialize separate counters
        let pendingAppointments = 0;
        let completedAppointments = 0;
        let pendingTransactions = 0;
        let completedTransactions = 0;

        // 4️⃣ Count appointments
        appointments.forEach(a => {
            if (a.status === 'pending' || a.status === 'approved') pendingAppointments++;
            else if (a.status === 'completed') completedAppointments++;
        });

        // 5️⃣ Count transactions
        transactions.forEach(t => {
            if (['submitted','ongoing','pending'].includes(t.status_name)) pendingTransactions++;
            else if (['completed','to_claim','claimed'].includes(t.status_name)) completedTransactions++;
        });

        // 6️⃣ Combine totals if you want a single "pending" or "completed" count
        const pendingItems = pendingAppointments + pendingTransactions;
        const completedItems = completedAppointments + completedTransactions;

        // 7️⃣ Return stats
        return {
            totalAppointments: appointments.length,
            totalTransactions: transactions.length,
            pendingAppointments,
            completedAppointments,
            pendingTransactions,
            completedTransactions,
            pendingItems,
            completedItems
        };

    } catch (error) {
        console.error('Error in getDashboardStatsModel:', error);
        throw error;
    }
}

export async function getRecentActivityModel(userId) {
    try {
        const activities = [];

        const appointmentQuery = `
            SELECT 
                appointment_id,
                appointment_date,
                appointment_time,
                status,
                created_at,
                'appointment' as type
            FROM appointments
            WHERE client_id = ?
            ORDER BY created_at DESC
            LIMIT 5
        `;
        const [recentAppointments] = await db.query(appointmentQuery, [userId]);

        recentAppointments.forEach(apt => {
            const appointmentDate = new Date(apt.appointment_date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            
            activities.push({
                type: 'appointment',
                title: `Appointment #${apt.appointment_id}`,
                description: `Scheduled for ${appointmentDate} at ${apt.appointment_time}`,
                created_at: apt.created_at
            });
        });

        // Get recent transaction updates (last 10)
        const transactionQuery = `
            SELECT 
                t.transaction_id,
                ts.status_name,
                s.service_name,
                t.updated_at as created_at,
                'transaction' as type
            FROM document_process_transaction t
            JOIN status ts ON t.current_status_id = ts.status_id
            JOIN services s ON t.service_id = s.service_id
            WHERE t.client_id = ?
            ORDER BY t.updated_at DESC
            LIMIT 10
        `;
        const [recentTransactions] = await db.query(transactionQuery, [userId]);

        recentTransactions.forEach(tx => {
            activities.push({
                type: 'transaction',
                title: `Transaction #${tx.transaction_id}`,
                description: `${tx.service_name} - Status: ${tx.status_name}`,
                created_at: tx.created_at
            });
        });

        // Get recent notifications (last 5)
        const notificationQuery = `
            SELECT 
                notification_id,
                title,
                message,
                created_at,
                'notification' as type
            FROM notifications
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 5
        `;
        const [recentNotifications] = await db.query(notificationQuery, [userId]);

        recentNotifications.forEach(notif => {
            activities.push({
                type: 'notification',
                title: notif.title,
                description: notif.message,
                created_at: notif.created_at
            });
        });

        // Sort all activities by date (most recent first) and return top 15
        activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        return activities.slice(0, 15);
    } catch (error) {
        console.error('Error in getRecentActivityModel:', error);
        throw error;
    }
}

export async function getUpcomingAppointmentsModel(userId) {
    try {
        const query = `
            SELECT 
                a.appointment_id,
                a.appointment_date,
                a.appointment_time,
                a.status,
                a.created_at,
                s.service_name
            FROM appointments a
            JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
            JOIN services s ON aps.service_id = s.service_id
            WHERE a.client_id = ?
            AND a.status = 'approved'
            AND a.appointment_date >= CURDATE()
            ORDER BY a.appointment_date ASC, a.appointment_time ASC
        `;

        const [rows] = await db.query(query, [userId]);

        // Group services by appointment
        const grouped = {};

        rows.forEach(row => {
            if (!grouped[row.appointment_id]) {
                grouped[row.appointment_id] = {
                    appointment_id: row.appointment_id,
                    appointment_date: row.appointment_date,
                    appointment_time: row.appointment_time,
                    status: row.status,
                    created_at: row.created_at,
                    services: []
                };
            }
            grouped[row.appointment_id].services.push(row.service_name);
        });

        // Return as array, limited to 10 appointments
        return Object.values(grouped).slice(0, 10);
    } catch (error) {
        console.error('Error in getUpcomingAppointmentsModel:', error);
        throw error;
    }
}

export async function getActiveTransactionsModel(userId) {
    try {
        const query = `
            SELECT 
                t.transaction_id,
                t.created_at,
                t.updated_at,
                ts.status_name,
                s.service_name,
                s.description as service_description
            FROM document_process_transaction t
            JOIN status ts ON t.current_status_id = ts.status_id
            JOIN services s ON t.service_id = s.service_id
            WHERE t.client_id = ?
            AND ts.status_name NOT IN ('claimed', 'completed', 'cancelled')
            ORDER BY t.updated_at DESC
            LIMIT 10
        `;

        const [transactions] = await db.query(query, [userId]);

        return transactions;
    } catch (error) {
        console.error('Error in getActiveTransactionsModel:', error);
        throw error;
    }
}

export async function getMonthlyOverviewModel(userId) {
    try {
        // Get current month's appointments
        const appointmentQuery = `
            SELECT COUNT(*) as count
            FROM appointments
            WHERE client_id = ?
            AND MONTH(created_at) = MONTH(CURDATE())
            AND YEAR(created_at) = YEAR(CURDATE())
        `;
        const [appointmentCount] = await db.query(appointmentQuery, [userId]);

        // Get current month's transactions
        const transactionQuery = `
            SELECT COUNT(*) as count
            FROM document_process_transaction
            WHERE client_id = ?
            AND MONTH(created_at) = MONTH(CURDATE())
            AND YEAR(created_at) = YEAR(CURDATE())
        `;
        const [transactionCount] = await db.query(transactionQuery, [userId]);

        return {
            monthlyAppointments: appointmentCount[0]?.count || 0,
            monthlyTransactions: transactionCount[0]?.count || 0
        };
    } catch (error) {
        console.error('Error in getMonthlyOverviewModel:', error);
        throw error;
    }
} 