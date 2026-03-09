
import {db} from "../config/db.js";

export async function getDashboardStatsModel() {
  try {
    // Total users by role
    const [userStats] = await db.execute(`
      SELECT 
        role,
        COUNT(*) as count,
        SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM users
      GROUP BY role
    `);

    // Total appointments by status
    const [appointmentStats] = await db.execute(`
      SELECT 
        status,
        COUNT(*) as count
      FROM appointments
      GROUP BY status
    `);

    // Today's appointments
    const [todayAppointments] = await db.execute(`
      SELECT COUNT(*) as count
      FROM appointments
      WHERE DATE(appointment_date) = CURDATE()
        AND status IN ('pending', 'approved')
    `);

    // Total document transactions by status
    const [transactionStats] = await db.execute(`
      SELECT 
        s.status_name,
        COUNT(*) as count
      FROM document_process_transaction dpt
      INNER JOIN status s ON dpt.current_status_id = s.status_id
      GROUP BY s.status_name
    `);

    // Active services
    const [serviceStats] = await db.execute(`
      SELECT 
        COUNT(*) as total_services,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_services
      FROM services
    `);

    // Recent activity (last 30 days)
    const [recentActivity] = await db.execute(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as new_appointments
      FROM appointments
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `);

    // Unread notifications count
    const [unreadNotifications] = await db.execute(`
      SELECT COUNT(*) as count
      FROM notifications
      WHERE is_read = 0
    `);

    // Active chat conversations
    const [activeChats] = await db.execute(`
      SELECT 
        COUNT(*) as total_conversations,
        SUM(CASE WHEN cc.last_message_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as active_today
      FROM chat_conversations cc
      WHERE status = 'active'
    `);

    // Unread messages count
    const [unreadMessages] = await db.execute(`
      SELECT COUNT(*) as count
      FROM chat_messages cm
      INNER JOIN chat_conversations cc ON cm.conversation_id = cc.conversation_id
      INNER JOIN users u ON cm.sender_id = u.id
      WHERE cm.is_read = 0 AND u.role = 'client'
    `);

    // Top services (most used)
    const [topServices] = await db.execute(`
      SELECT 
        s.service_name,
        COUNT(dpt.transaction_id) as transaction_count
      FROM services s
      LEFT JOIN document_process_transaction dpt ON s.service_id = dpt.service_id
      WHERE s.is_active = 1
      GROUP BY s.service_id, s.service_name
      ORDER BY transaction_count DESC
      LIMIT 5
    `);

    // Processing time statistics
    const [processingStats] = await db.execute(`
      SELECT 
        AVG(DATEDIFF(dpt.updated_at, dpt.created_at)) as avg_processing_days,
        MIN(DATEDIFF(dpt.updated_at, dpt.created_at)) as min_processing_days,
        MAX(DATEDIFF(dpt.updated_at, dpt.created_at)) as max_processing_days
      FROM document_process_transaction dpt
      INNER JOIN status s ON dpt.current_status_id = s.status_id
      WHERE s.status_name IN ('claimed', 'completed')
    `);

    // Monthly trends (last 6 months)
    const [monthlyTrends] = await db.execute(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month,
        COUNT(*) as transaction_count
      FROM document_process_transaction
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY month DESC
    `);

    return {
      userStats,
      appointmentStats: appointmentStats.reduce((acc, curr) => {
        acc[curr.status] = curr.count;
        return acc;
      }, {}),
      todayAppointments: todayAppointments[0].count,
      transactionStats: transactionStats.reduce((acc, curr) => {
        acc[curr.status_name] = curr.count;
        return acc;
      }, {}),
      serviceStats: serviceStats[0],
      recentActivity,
      unreadNotifications: unreadNotifications[0].count,
      activeChats: activeChats[0],
      unreadMessages: unreadMessages[0].count,
      topServices,
      processingStats: processingStats[0] || { avg_processing_days: 0, min_processing_days: 0, max_processing_days: 0 },
      monthlyTrends
    };
  } catch (error) {
    throw error;
  }
}

export async function getRecentActivitiesModel(limit = 10) {
  try {
    const [activities] = await db.execute(`
      (
        SELECT 
          'appointment' as type,
          a.appointment_id as id,
          CONCAT(u.first_name, ' ', u.last_name) as user_name,
          a.status,
          a.created_at
        FROM appointments a
        INNER JOIN users u ON a.client_id = u.id
        ORDER BY a.created_at DESC
        LIMIT ?
      )
      UNION ALL
      (
        SELECT 
          'transaction' as type,
          dpt.transaction_id as id,
          CONCAT(u.first_name, ' ', u.last_name) as user_name,
          s.status_name as status,
          dpt.created_at
        FROM document_process_transaction dpt
        INNER JOIN users u ON dpt.client_id = u.id
        INNER JOIN status s ON dpt.current_status_id = s.status_id
        ORDER BY dpt.created_at DESC
        LIMIT ?
      )
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit, limit, limit]);

    return activities;
  } catch (error) {
    throw error;
  }
}
