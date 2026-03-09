import {getAllServices,addService,editService,verifyService ,verifyUpdateService, toggleServiceStatus,searchService,filterClientAppointments,getScheduleForecastModel} from '../model/serviceModel.js'
import {getDocumentTransactionsByStatusModel,getWalikinDocumentTransactions,searchDocumentTransactionsByStatusModel,getTransactionByIdModel,updateTransactionStatusModel,getTransactionTimelineModel,getAllStatusesModel,createNotificationModel,getTransactionReportDataModel} from "../model/documentTransactionModel.js";
import { sendClientDocumentProcessUpdate,sendReadyToClaimEmail,sendAppointmentCompletionEmail } from "../services/emailService.js";
import { getAllUsersModel,searchUsersByNameModel } from "../model/adminModel.js";
import { getDashboardStatsModel, getRecentActivitiesModel } from "../model/dashboardModel.js";
import {getAppointmentByIdModel,getAppointmentServicesModel,getAllActiveServicesModel,completeAppointmentWithTransactionsModel, searchAppointmentsModel} from "../model/appointmentModel.js";

import { banUserModel, unbanUserModel, getAllClientsModel, getUserById } from '../model/userModel.js';
import { createWalkInTransactionModel, searchClientForWalkInModel, setReadyDateModel } from '../model/walkInModel.js';
import { createTestimonialModel, getAllTestimonialsAdminModel } from '../model/testimonialModel.js';
import { emitToUser, emitToAdmins } from '../config/socket.js';
import { db } from '../config/db.js';


// ── SCHEDULE FORECAST DETAIL ──────────────────────────────────
export async function getAppointmentForecastDetail(req, res) {
  try {
    const { appointmentId } = req.params;

    const [rows] = await db.execute(
      `SELECT
         a.appointment_id,
         a.appointment_date,
         a.appointment_time,
         a.notes,
         a.status,
         a.remarks,
         a.created_at,
         u.first_name,
         u.last_name,
         u.email,
         u.phone_number,
         u.sex,
         GROUP_CONCAT(s.service_name SEPARATOR ', ') AS services
       FROM appointments a
       INNER JOIN users u ON a.client_id = u.id
       LEFT JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
       LEFT JOIN services s ON aps.service_id = s.service_id
       WHERE a.appointment_id = ?
       GROUP BY a.appointment_id`,
      [appointmentId]
    );

    if (!rows.length) return res.status(404).json({ message: 'Appointment not found' });
    return res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Forecast detail error:', error);
    return res.status(500).json({ message: 'Failed to fetch appointment detail' });
  }
}

// ── BAN CLIENT ────────────────────────────────────────────────
export async function banClientController(req, res) {
  try {
    const adminId = req.user?.id;
    const { userId } = req.params;
    const { banType, banReason } = req.body;

    if (!['3_days', '30_days', 'permanent'].includes(banType)) {
      return res.status(400).json({ message: 'Invalid ban type' });
    }

    const result = await banUserModel(userId, adminId, banType, banReason || '');

    // Get user info for notification
    const user = await getUserById(userId);

    // Notify the banned user in realtime
    const msg = banType === 'permanent'
      ? 'Your account has been permanently banned.'
      : `Your account has been banned until ${new Date(result.banUntil).toLocaleString('en-PH')}.`;

    emitToUser(userId, 'account_banned', {
      banned: true,
      ban_type: banType,
      ban_until: result.banUntil,
      message: msg
    });

    // Admin notification
    emitToAdmins('admin_notification', {
      type: 'ban_applied',
      title: 'Client Banned',
      message: `${user?.first_name} ${user?.last_name} has been banned (${banType})`,
      timestamp: new Date()
    });

    // Create notification record for user
    await db.execute(
      `INSERT INTO notifications (user_id, type, title, message)
       VALUES (?, 'ban_applied', 'Account Banned', ?)`,
      [userId, msg]
    );

    return res.status(200).json({ message: 'User banned successfully', banUntil: result.banUntil });
  } catch (error) {
    console.error('Ban error:', error);
    return res.status(500).json({ message: 'Failed to ban user' });
  }
}

// ── UNBAN CLIENT ──────────────────────────────────────────────
export async function unbanClientController(req, res) {
  try {
    const adminId = req.user?.id;
    const { userId } = req.params;

    await unbanUserModel(userId, adminId);

    emitToUser(userId, 'account_unbanned', {
      banned: false,
      message: 'Your account ban has been lifted.'
    });

    return res.status(200).json({ message: 'User unbanned successfully' });
  } catch (error) {
    console.error('Unban error:', error);
    return res.status(500).json({ message: 'Failed to unban user' });
  }
}

// ── GET ALL CLIENTS (Admin panel) ─────────────────────────────
export async function getClientsController(req, res) {
  try {
    const search = req.query.search || '';
    const clients = await getAllClientsModel(search);
    return res.status(200).json(clients);
  } catch (error) {
    console.error('Get clients error:', error);
    return res.status(500).json({ message: 'Failed to fetch clients' });
  }
}

// ── CLIENT FULL HISTORY ────────────────────────────────────────
export async function getClientFullHistoryController(req, res) {
  try {
    const { userId } = req.params;

    // Appointments
    const [appointments] = await db.execute(
      `SELECT a.*, GROUP_CONCAT(s.service_name SEPARATOR ', ') as services
       FROM appointments a
       LEFT JOIN appointment_service aps ON a.appointment_id = aps.appointment_id
       LEFT JOIN services s ON aps.service_id = s.service_id
       WHERE a.client_id = ?
       GROUP BY a.appointment_id
       ORDER BY a.created_at DESC`,
      [userId]
    );

    // Transactions
    const [transactions] = await db.execute(
      `SELECT dpt.*, s.service_name, st.status_name,
              dpt.ready_date, dpt.claim_deadline, dpt.penalty_amount, dpt.has_penalty,
              dpt.transaction_type
       FROM document_process_transaction dpt
       INNER JOIN services s ON dpt.service_id = s.service_id
       INNER JOIN status st ON dpt.current_status_id = st.status_id
       WHERE dpt.client_id = ?
       ORDER BY dpt.created_at DESC`,
      [userId]
    );

    // Conversation
    const [conversations] = await db.execute(
      `SELECT cc.conversation_id FROM chat_conversations cc
       WHERE cc.client_id = ? AND cc.status = 'active' LIMIT 1`,
      [userId]
    );

    return res.status(200).json({
      appointments,
      transactions,
      conversationId: conversations[0]?.conversation_id || null
    });
  } catch (error) {
    console.error('Client history error:', error);
    return res.status(500).json({ message: 'Failed to fetch client history' });
  }
}

// ── WALK-IN TRANSACTION ────────────────────────────────────────
export async function createWalkInController(req, res) {
  try {
    const adminId = req.user.id;
    

    const { clientId, serviceId, notes } = req.body;

    if (!clientId || !serviceId) {
      return res.status(400).json({ message: 'Client and service are required' });
    }

    const result = await createWalkInTransactionModel(adminId, clientId, serviceId, notes);
    if (result.error) return res.status(400).json({ message: result.error });

    // Notify client
    emitToUser(clientId, 'notification', {
      type: 'walk_in_created',
      title: 'Walk-In Transaction Created',
      message: 'A walk-in transaction has been created for you by the office.',
      related_id: result.transactionId
    });

    return res.status(201).json({
      message: 'Walk-in transaction created successfully',
      transactionId: result.transactionId
    });
  } catch (error) {
    console.error('Walk-in error:', error);
    return res.status(500).json({ message: 'Failed to create walk-in transaction' });
  }
}

export async function searchClientWalkInController(req, res) {
  try {
    const { search } = req.query;
    if (!search || search.trim().length < 2) {
      return res.status(400).json({ message: 'Search term must be at least 2 characters' });
    }
    const clients = await searchClientForWalkInModel(search.trim());
    return res.status(200).json(clients);
  } catch (error) {
    console.error('Search client error:', error);
    return res.status(500).json({ message: 'Search failed' });
  }
}

// ── CREATE APPOINTMENT (Admin Manual) ────────────────────────
export async function createAdminAppointmentController(req, res) {
  try {
    const adminId = req.user?.id;
    const { clientId, serviceIds, appointmentDate, appointmentTime, notes } = req.body;

    if (!clientId || !serviceIds?.length || !appointmentDate || !appointmentTime) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Create appointment as approved (admin created = pre-approved)
      const [apptResult] = await connection.execute(
        `INSERT INTO appointments (client_id, appointment_date, appointment_time, notes, status)
         VALUES (?, ?, ?, ?, 'approved')`,
        [clientId, appointmentDate, appointmentTime, notes || '']
      );
      const appointmentId = apptResult.insertId;

      // Link services
      for (const serviceId of serviceIds) {
        await connection.execute(
          `INSERT INTO appointment_service (appointment_id, service_id) VALUES (?, ?)`,
          [appointmentId, serviceId]
        );
      }

      // Notify client
      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, related_id)
         VALUES (?, 'appointment', 'Appointment Scheduled',
                 'An appointment has been scheduled for you by the office.', ?)`,
        [clientId, appointmentId]
      );

      await connection.commit();

      // Realtime notification
      emitToUser(clientId, 'notification', {
        type: 'appointment',
        title: 'Appointment Scheduled',
        message: `An appointment has been scheduled for you on ${appointmentDate} at ${appointmentTime}.`
      });

      return res.status(201).json({ message: 'Appointment created successfully', appointmentId });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Admin appointment error:', error);
    return res.status(500).json({ message: 'Failed to create appointment' });
  }
}

// ── READY TO CLAIM (sets deadline) ────────────────────────────
export async function setTransactionReadyController(req, res) {
  try {
    const adminId = req.user?.id;
    const { transactionId } = req.params;

    const result = await setReadyDateModel(transactionId, adminId);

    if (result.clientInfo) {
      // Send email notification — pass serviceName correctly
      await sendReadyToClaimEmail(
        result.clientInfo,
        transactionId,
        result.claimDeadline,
        result.clientInfo.service_name   // ← was missing
      );

      // Realtime notification to client
      emitToUser(result.clientInfo.client_id, 'notification', {
        type: 'status_update',
        title: 'Document Ready to Claim',
        message: `Your document is ready. Please claim by ${result.claimDeadline.toLocaleDateString('en-PH')} to avoid a ₱200 penalty.`
      });
    }

    return res.status(200).json({
      message: 'Transaction marked as ready to claim',
      claimDeadline: result.claimDeadline
    });
  } catch (error) {
    console.error('Set ready error:', error);
    return res.status(500).json({ message: 'Failed to update transaction' });
  }
}

// ── TESTIMONIALS (Admin view) ─────────────────────────────────
export async function getTestimonialsAdminController(req, res) {
  try {
    const testimonials = await getAllTestimonialsAdminModel();
    return res.status(200).json(testimonials);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch testimonials' });
  }
}

// dashboadr
export async function getDashboardStatsController(req, res) {
  try {
    const stats = await getDashboardStatsModel();
    const recentActivities = await getRecentActivitiesModel(10);

    res.status(200).json({
      stats,
      recentActivities
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ message: "Failed to fetch dashboard statistics" });
  }
}



// ========== SERVICES MANAGEMENT ==========

export async function fetchAllServices(req,res) {
    const services = await getAllServices()
    return res.json(services);

}

export async function createService(req,res) {
    const {serviceName,description} =req.body
    console.log(serviceName,description)

    const isServiceNameExist=await verifyService(serviceName)
    if (isServiceNameExist) return res.status(401).json({message:'Service Name already used!',success:'error'})

    const serviceID = await addService(serviceName,description);
    if(serviceID) return res.status(201).json({message:'Service added successfully',success:'success'})

    return res.status(403).json({message:'Error adding service',success:'error'})
}

export async function updateService(req,res) {
    const {serviceName,description} =req.body
    const serviceID=req.params.id

    const isServiceNameExist=await verifyUpdateService(serviceName,serviceID)
    if (isServiceNameExist) return res.status(401).json({message:'Service Name already used!',success:'error'})

    const affectedRows = await editService(serviceID,serviceName,description);
    if(affectedRows) return res.status(201).json({message:'Service added successfully',success:'success'})
    return res.status(403).json({message:'Error updating service',success:'error'})
}

export async function updateServiceStatus(req,res) {
    const {serviceID,newStatus} =req.body
                console.log(serviceID,newStatus)

    const affectedRows = await toggleServiceStatus(serviceID,newStatus)
   
    if(affectedRows) return res.status(201).json({message:'Service status updated successfully',success:'success'})
    return res.status(403).json({message:'Error updating service status',success:'error'})
}

export async function searchServices(req,res) {
    const searchWord = req.params.searchWord

    const services = await searchService(searchWord)
   
    return res.json(services)
}

// ========== USERS MANAGEMENT ==========
export async function getAllUsersController(req,res) {
  const role = req.params.role
  const users = await getAllUsersModel(role)
  return res.status(200).json(users)
}

export async function searchUsersController(req,res) {
  const searchTerm = req.params.searchTerm
  const users = await searchUsersByNameModel(searchTerm)
  return res.status(200).json(users)
}

// ========== APPOINTMENT MANAGEMENT ==========

export async function getAppointments(req,res) {
    const status = req.params.status
    const appointments = await filterClientAppointments(status)
    return res.json(appointments)
}

export async function getAllAppointmentsController(req, res) {
  const { status, date, page = 1, limit = 20 } = req.query;

  const appointments = await getAllAppointmentsModel(status, date, page, limit);
  const total = await getAppointmentCountModel(status, date);

  return res.json({
    appointments,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
}

export async function updateAppointmentStatusController(req, res) {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { status, remarks } = req.body;

    // Validate status
    const validStatuses = ['pending', 'approved', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      await connection.rollback();
      return res.status(400).json({ message: 'Invalid status' });
    }

    // Get appointment details before update
    const appointmentData = await getAppointmentWithClientInfoModel(connection, id);

    if (!appointmentData) {
      await connection.rollback();
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Update appointment status
    await updateAppointmentStatusModel(connection, id, status, remarks);

    // If cancelling, update time slot
    if (status === 'cancelled' && appointmentData.old_status !== 'cancelled') {
      await decrementTimeSlotBookingModel(
        connection,
        appointmentData.appointment_date,
        appointmentData.appointment_time
      );
    }

    // Create notification for client
    const notificationTitle = getNotificationTitle(status);
    const notificationMessage = getNotificationMessage(
      status,
      appointmentData.appointment_date,
      appointmentData.appointment_time,
      remarks
    );

    await createNotificationModel(
      connection,
      appointmentData.client_id,
      'appointment',
      notificationTitle,
      notificationMessage,
      id
    );

    await connection.commit();

    // Send email notification (async, don't wait)
    const emailData = {
      firstName: appointmentData.first_name,
      date: new Date(appointmentData.appointment_date).toLocaleDateString(),
      time: appointmentData.appointment_time,
      services: appointmentData.services,
      remarks: remarks || null
    };
    
    sendAppointmentEmailService(status, appointmentData.email, emailData);

    return res.json({ 
      message: `Appointment ${status} successfully. Email notification sent to client.` 
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error updating appointment:', error);
    return res.status(500).json({ message: 'Failed to update appointment' });
  } finally {
    connection.release();
  }
}

export async function getAppointmentServicesController(req, res) {
  try {
    const { appointmentId } = req.params;

    // Get appointment details
    const appointment = await getAppointmentByIdModel(appointmentId);
    
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Get services from this appointment
    const appointmentServices = await getAppointmentServicesModel(appointmentId);

    // Get all active services
    const allServices = await getAllActiveServicesModel();

    res.status(200).json({
      appointment,
      appointmentServices,
      allServices
    });
  } catch (error) {
    console.error("Error fetching appointment services:", error);
    res.status(500).json({ message: "Failed to fetch appointment services" });
  }
}

export async function completeAppointmentController(req, res) {
  try {
    const { appointmentId, selectedServiceIds, remarks } = req.body;
    const completedBy = req.user.id; 

    if (!appointmentId || !selectedServiceIds || selectedServiceIds.length === 0) {
      return res.status(400).json({ 
        message: "Appointment ID and at least one service must be selected" 
      });
    }

    const result = await completeAppointmentWithTransactionsModel(
      appointmentId,
      selectedServiceIds,
      completedBy,
      remarks || 'Appointment completed successfully'
    );

    const appointment = await getAppointmentByIdModel(appointmentId);

    const [serviceRows] = await db.execute(
      `SELECT service_name FROM services WHERE service_id IN (${selectedServiceIds.map(() => '?').join(',')})`,
      selectedServiceIds
    );

    const serviceNames = serviceRows.map(s => s.service_name);

    const emailData = {
      appointmentId: appointment.appointment_id,
      clientName: `${appointment.first_name} ${appointment.last_name}`,
      appointmentDate: appointment.appointment_date,
      appointmentTime: appointment.appointment_time,
      services: serviceNames,
      transactionCount: result.transactionIds.length,
      remarks: remarks
    };

    await sendAppointmentCompletionEmail(emailData, appointment.email);

    res.status(200).json({
      message: "Appointment completed successfully and document transactions created",
      success: true,
      transactionIds: result.transactionIds,
      transactionCount: result.transactionIds.length
    });
  } catch (error) {
    console.error("Error completing appointment:", error);
    res.status(500).json({ 
      message: error.message || "Failed to complete appointment" 
    });
  }
}



// ========== TIME SLOT MANAGEMENT ==========

export async function getTimeSlotsController(req, res) {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ message: 'Date is required' });
  }

  const slots = await getTimeSlotsByDateModel(date);
  return res.json(slots);
}

export async function updateTimeSlotController(req, res) {
  const { id } = req.params;
  const { max_capacity, is_available } = req.body;

  const affectedRows = await updateTimeSlotModel(id, max_capacity, is_available);
  
  if (affectedRows) {
    return res.json({ message: 'Time slot updated successfully' });
  }
  
  return res.status(404).json({ message: 'Time slot not found' });
}

// ========== HELPER FUNCTIONS ==========

function getNotificationTitle(status) {
  const titles = {
    approved: 'Appointment Approved ✓',
    completed: 'Appointment Completed',
    cancelled: 'Appointment Cancelled',
    pending: 'Appointment Pending'
  };
  return titles[status] || 'Appointment Update';
}

function getNotificationMessage(status, date, time, remarks) {
  const formattedDate = new Date(date).toLocaleDateString();
  
  const messages = {
    approved: `Your appointment for ${formattedDate} at ${time} has been approved! Please arrive 10 minutes early and bring all required documents.`,
    completed: `Your appointment for ${formattedDate} at ${time} has been completed. Thank you for using our services!`,
    cancelled: `Your appointment for ${formattedDate} at ${time} has been cancelled by the admin.${remarks ? ` Reason: ${remarks}` : ''}`,
    pending: `Your appointment for ${formattedDate} at ${time} is pending approval.`
  };
  
  return messages[status] || `Your appointment status has been updated to ${status}.`;
}

// DOCUMENT TRANSACTION

export async function getDocumentTransactionsController(req, res) {
    const  status  = req.params.status;
 
    const transactions = await getDocumentTransactionsByStatusModel(status);
    
    res.status(200).json(transactions);
}

export async function getWalkinDocumentTransactionsController(req, res) {
 
    const transactions = await getWalikinDocumentTransactions();
    
    res.status(200).json(transactions);
}

export async function searchDocumentTransactionsController(req, res) {

  const {searchTerm,status} = req.params;
  
  const appointments = await searchDocumentTransactionsByStatusModel(searchTerm,status)
  return res.json(appointments)
  

}

export async function getTransactionTimelineController(req, res) {
  try {
    const { transactionId } = req.params;
    const timeline = await getTransactionTimelineModel(transactionId);
    
    res.status(200).json(timeline);
  } catch (error) {
    console.error("Error fetching timeline:", error);
    res.status(500).json({ message: "Failed to fetch transaction timeline" });
  }
}

export async function updateTransactionStatusController(req, res) {
    try {
        const { transactionId, statusId, remarks } = req.body;
        const changedBy = req.user.id;

        // Handle uploaded images
        let imagePaths = [];
        if (req.files && req.files.length > 0) {
            imagePaths = req.files.map(file => ({
                path: file.path,
                filename: file.filename,
                size: file.size.toString()
            }));
        }

        // Update transaction status in DB
        await updateTransactionStatusModel(transactionId,statusId,changedBy,remarks,imagePaths
        );

        const transaction = await getTransactionByIdModel(transactionId);

        // Get status name
        const statuses = await getAllStatusesModel();
        const status = statuses.find(s => s.status_id === parseInt(statusId));

        // Create notification for client
        await createNotificationModel(
            transaction.client_id,
            'status_update',
            'Document Process Update',
            `Your ${transaction.service_name} has been updated to: ${status.status_name}`,
            transactionId
        );

        // Realtime notification to client
        emitToUser(transaction.client_id, 'notification', {
            type: 'status_update',
            title: 'Document Process Update',
            message: `Your ${transaction.service_name} has been updated to: ${status.status_name}`,
            related_id: transactionId
        });

        // Realtime notification to admins if document claimed
        if (status.status_name === 'claimed') {
            emitToAdmins('admin_notification', {
                type: 'document_claimed',
                title: 'Document Claimed',
                message: `Transaction #${transactionId} (${transaction.service_name}) has been claimed by the client.`,
                timestamp: new Date()
            });
        }

        // ───── EMAIL LOGIC ─────
        if (parseInt(statusId) === 4) {
            // Ready-to-claim logic
            const result = await setReadyDateModel(transactionId, changedBy);

            const emailData = {
                email: transaction.email,
                first_name:transaction.first_name,
                last_name: transaction.last_name,
            };


            if (result.clientInfo) {
                await sendReadyToClaimEmail(
                    emailData,
                    transactionId,
                    result.claimDeadline,
                    result.clientInfo.service_name
                );

                emitToUser(result.clientInfo.client_id, 'notification', {
                    type: 'status_update',
                    title: 'Document Ready to Claim',
                    message: `Your document is ready. Please claim by ${result.claimDeadline.toLocaleDateString('en-PH')} to avoid a ₱200 penalty.`
                });
            }
        } else {
            // All other status updates
            const emailData = {
                transactionId: transaction.transaction_id,
                serviceName: transaction.service_name,
                statusName: status.status_name,
                remarks: remarks,
                clientName: `${transaction.first_name} ${transaction.last_name}`,
                hasImages: imagePaths.length > 0
            };

            await sendClientDocumentProcessUpdate(emailData, transaction.email);
        }

        return res.status(200).json({
            message: 'Transaction status updated successfully',
            success: true
        });

    } catch (error) {
        console.error('Update transaction status error:', error);
        return res.status(500).json({ message: 'Failed to update transaction' });
    }
}

export async function getAllStatusesController(req, res) {
  try {
    const statuses = await getAllStatusesModel();
    res.status(200).json(statuses);
  } catch (error) {
    console.error("Error fetching statuses:", error);
    res.status(500).json({ message: "Failed to fetch statuses" });
  }
}

export async function getTransactionReportController(req, res) {
  try {
    const { transactionId } = req.params;

    const reportData = await getTransactionReportDataModel(transactionId);

    if (!reportData) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    res.status(200).json(reportData);
  } catch (error) {
    console.error("Error fetching transaction report:", error);
    res.status(500).json({ message: "Failed to fetch transaction report" });
  }
}

export const searchAppointmentsController = async (req, res) => {
    try {
        const { searchTerm, status } = req.params;
        console.log('Search params:', { searchTerm, status });

        const appointments = await searchAppointmentsModel(searchTerm, status);
        res.status(200).json(appointments);

    } catch (error) {
        console.error('searchAppointmentsController error:', error.message);
        res.status(500).json({ message: 'Failed to search appointments', error: error.message });
    }
};

//schedule

export const getScheduleForecastController = async (req, res) => {
  try {
    const { startDate, endDate } = req.params;

    // Basic date validation
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const data = await getScheduleForecastModel(startDate, endDate);
    res.status(200).json(data);

  } catch (error) {
    console.error('getScheduleForecastController error:', error.message);
    res.status(500).json({ message: 'Failed to fetch schedule forecast', error: error.message });
  }
};
