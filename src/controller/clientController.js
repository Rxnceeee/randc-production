import { setupUser,getAvailableTimeSlotsModel ,getUserNotificationsModel,markAllNotificationsAsReadModel,incrementTimeSlotBookingModel,markNotificationAsReadModel,checkTimeSlotAvailabilityModel,createDefaultTimeSlotsModel,createTimeSlotModel} from "../model/clientModel.js"
import {getUserById,getUserCridentials ,changeClientPassword} from "../model/userModel.js";
import {getClientAppointments,submitClientAppointmentsModel,getClientActiveAppointment,cancelAppointment} from '../model/serviceModel.js';
import {createNotificationModel,getDashboardStatsModel,getRecentActivityModel,getUpcomingAppointmentsModel,getActiveTransactionsModel,getMonthlyOverviewModel,getClientTransactionReceiptModel,getClientTransactionsByStatusModel,searchClientTransactionsModel,getClientTransactionTimelineModel,cancelClientTransactionModel } from '../model/documentTransactionModel.js';
import { hashPassword,comparePassword } from "../services/authService.js";
import { sendAppointmentEmailService } from "../services/emailService.js";
import { db } from '../config/db.js';

import {
  createTestimonialModel,
  getPublicTestimonialsModel,
  getTestimonialByTransactionModel,
  getMyTestimonialsModel
} from '../model/testimonialModel.js';
import { emitToAdmins } from '../config/socket.js';


// ── SUBMIT TESTIMONIAL ────────────────────────────────────────
export async function submitTestimonialController(req, res) {
  try {
    const userId = req.user?.id;
    const { transactionId, rating, message } = req.body;

    if (!transactionId || !rating || !message) {
      return res.status(400).json({ message: 'Transaction ID, rating, and message are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    if (message.trim().length < 10) {
      return res.status(400).json({ message: 'Message must be at least 10 characters' });
    }

    const result = await createTestimonialModel(userId, transactionId, rating, message.trim());

    if (result.error) {
      return res.status(400).json({ message: result.error });
    }

    // Notify admins
    emitToAdmins('admin_notification', {
      type: 'testimonial_submitted',
      title: 'New Testimonial',
      message: `A new ${rating}-star testimonial was submitted (${result.initials})`,
      timestamp: new Date()
    });

    // Add to notifications table
    await db.execute(
      `INSERT INTO notifications (user_id, type, title, message, related_id)
       SELECT admin.id, 'testimonial_submitted', 'New Testimonial Submitted',
              CONCAT('A ', ?, '-star testimonial was submitted for transaction #', ?),
              ?
       FROM users admin WHERE admin.role = 'admin' LIMIT 5`,
      [rating, transactionId, transactionId]
    );

    return res.status(201).json({
      message: 'Thank you for your testimonial!',
      initials: result.initials
    });
  } catch (error) {
    console.error('Testimonial submit error:', error);
    return res.status(500).json({ message: 'Failed to submit testimonial' });
  }
}

// ── GET PUBLIC TESTIMONIALS ────────────────────────────────────
export async function getPublicTestimonialsController(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const testimonials = await getPublicTestimonialsModel(limit);
    return res.status(200).json(testimonials);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch testimonials' });
  }
}

// ── CHECK IF CLIENT CAN LEAVE TESTIMONIAL ─────────────────────
export async function checkTestimonialEligibilityController(req, res) {
  try {
    const userId = req.user?.id;

    // Get all claimed transactions without testimonials
    const [eligible] = await db.execute(
      `SELECT dpt.transaction_id, s.service_name, dpt.updated_at as claimed_at
       FROM document_process_transaction dpt
       INNER JOIN status st ON dpt.current_status_id = st.status_id
       INNER JOIN services s ON dpt.service_id = s.service_id
       LEFT JOIN testimonials t ON t.transaction_id = dpt.transaction_id
       WHERE dpt.client_id = ?
         AND st.status_name = 'claimed'
         AND t.testimonial_id IS NULL
       ORDER BY dpt.updated_at DESC`,
      [userId]
    );

    return res.status(200).json({ eligible });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to check eligibility' });
  }
}

// ── MY TESTIMONIALS ───────────────────────────────────────────
export async function getMyTestimonialsController(req, res) {
  try {
    const userId = req.user.id;
    const testimonials = await getMyTestimonialsModel(userId);
    return res.status(200).json({ testimonials });
  } catch (error) {
    console.error('My testimonials error:', error);
    return res.status(500).json({ message: 'Failed to fetch your testimonials' });
  }
}


export async function setupAccountController(req,res) {
    const {firstName,lastName,middleName,sex}=req.body
    
    const userId=req.user.id

    const affectedRows =await setupUser(firstName,lastName,middleName,sex,userId);
    const user =  await getUserById(userId)
    if(affectedRows) return res.status(200).json({message: 'Profile completed successfully!',user})
}

export async function changePasswordController(req,res) {
    const newPassword = req.body.newPassword
    const currentPassword = req.body.currentPassword
    const username = req.user.username
    const userID = req.user.id
    

    const userCredentials = await getUserCridentials(username);

    const isMatch = await comparePassword(currentPassword, userCredentials.password);
    if (!isMatch) {
        return res.status(401).json({ message: "Current Password doesnt match" });
    }else{
        const hashedPassword= await hashPassword(newPassword);
        
        await changeClientPassword(hashedPassword,userID);
        return res.status(200).json({ message: "Password changed Successfully" });
    }
}

// DASHBOARD
export async function getDashboardStatsController(req, res) {
    try {
        const userId = req.user.id;

        const stats = await getDashboardStatsModel(userId);
        
        return res.json(stats);
    } catch (error) {
        console.error('Error in getDashboardStatsController:', error);
        return res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
    }
}

export async function getRecentActivityController(req, res) {
    try {
        const userId = req.user.id;

        const activities = await getRecentActivityModel(userId);
        
        return res.json(activities);
    } catch (error) {
        console.error('Error in getRecentActivityController:', error);
        return res.status(500).json({ message: 'Failed to fetch recent activity' });
    }
}

export async function getUpcomingAppointmentsController(req, res) {
    try {
        const userId = req.user.id;

        const appointments = await getUpcomingAppointmentsModel(userId);
        
        return res.json(appointments);
    } catch (error) {
        console.error('Error in getUpcomingAppointmentsController:', error);
        return res.status(500).json({ message: 'Failed to fetch upcoming appointments' });
    }
}

export async function getActiveTransactionsController(req, res) {
    try {
        const userId = req.user.id;

        const transactions = await getActiveTransactionsModel(userId);
        
        return res.json(transactions);
    } catch (error) {
        console.error('Error in getActiveTransactionsController:', error);
        return res.status(500).json({ message: 'Failed to fetch active transactions' });
    }
}

export async function getMonthlyOverviewController(req, res) {
    try {
        const userId = req.user.id;

        const overview = await getMonthlyOverviewModel(userId);
        
        return res.json(overview);
    } catch (error) {
        console.error('Error in getMonthlyOverviewController:', error);
        return res.status(500).json({ message: 'Failed to fetch monthly overview' });
    }
}

// APPOINTMENT
export async function cancelClientAppointmentController(req,res) {
    const userID = req.user.id;

    const appointmentID=req.params.appointmentID;
    const reason = req.body.reason;

    const affectedRows = await cancelAppointment(appointmentID,reason);

    if(affectedRows) {
      await createNotificationModel(
        userID,
        'appointment',
        'Appointment Cancelled',
        `Your appointment has been cancelled successfully.`,
        appointmentID
      );

      // ── REALTIME: notify admins of cancellation ──────────────
      emitToAdmins('admin_notification', {
        type: 'appointment_cancelled',
        title: 'Appointment Cancelled',
        message: `A client cancelled their appointment (ID: ${appointmentID})`,
        timestamp: new Date()
      });

      res.status(200).json({ message: "Appointment Cancelled Successfully" });
    } 
}

export async function getAppointmentsController(req,res) {
    const userID = req.user.id;
    const {status} = req.params

    const appointment = await getClientAppointments(userID,status);
    
    return res.json(appointment)
    
}

export async function submitAppointmentController(req, res) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { services, date, time, notes } = req.body;
    const clientId = req.user.id;
    const clientEmail = req.user.email;

    const formData = { services, date, time, notes: notes || null };

    // Validate inputs
    if (!services || !Array.isArray(services) || services.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Please select at least one service' });
    }

    if (!date || !time) {
      await connection.rollback();
      return res.status(400).json({ message: 'Date and time are required' });
    }

    // Prevent booking that has active appointments
    const hasActiveAppointment = await getClientActiveAppointment(clientId);
    if (hasActiveAppointment) {
      await connection.rollback();
      return res.status(401).json({ message: "You already have an active appointment. Please complete or cancel it before booking another." });
    }

    // Check slot
    const slotCheck = await checkTimeSlotAvailabilityModel(date, time);

    if (!slotCheck) {
      await createTimeSlotModel(date, time);
    } else if (slotCheck.current_bookings >= slotCheck.max_capacity) {
      await connection.rollback();
      return res.status(400).json({
        message: 'This time slot is now fully booked. Please select another time.'
      });
    }

    // Insert appointment
    const appointmentId = await submitClientAppointmentsModel(connection, clientId, formData);

    await incrementTimeSlotBookingModel(date, time);

    await createNotificationModel(
      clientId,
      'appointment',
      'Appointment Approved',
      `Your appointment for ${date} at ${time} has been successfully submitted and marked as approved.`,
      appointmentId
    );

    await connection.commit();

    // ── REALTIME: notify admins of new appointment ─────────────
    emitToAdmins('admin_notification', {
      type: 'new_appointment',
      title: 'New Appointment Submitted',
      message: `New appointment submitted for ${date} at ${time}`,
      timestamp: new Date()
    });

    // Send email AFTER commit
    try {
      await sendAppointmentEmailService('approved', clientEmail, {
        firstName: req.user.first_name,
        date,
        time,
        services: services.map(s => s.name).join(', '),
        remarks: notes
      });
    } catch (emailErr) {
      console.warn('Email failed but appointment saved:', emailErr);
    }

    return res.status(201).json({
      message: 'Appointment submitted successfully!',
      appointmentId
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error submitting appointment:', error);
    return res.status(500).json({ message: 'Failed to submit appointment' });
  } finally {
    connection.release();
  }
}

export async function getAvailableTimeSlotsController(req, res) {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ message: 'Date is required' });
  }

  const slots = await getAvailableTimeSlotsModel(date);

  // If no slots exist for this date, create default slots
  if (slots.length === 0) {
    await createDefaultTimeSlotsModel(date);
    const newSlots = await getAvailableTimeSlotsModel(date);
    return res.json(newSlots);
  }

  return res.json(slots);
}

export async function getNotificationsController(req, res) {
  const userId = req.user.id;
  const notifications = await getUserNotificationsModel(userId);
  return res.json(notifications);
}

export async function markNotificationAsReadController(req, res) {
  const { id } = req.params;
  const userId = req.user.id;

  const affectedRows = await markNotificationAsReadModel(id, userId);
  
  if (affectedRows) {
    return res.json({ message: 'Notification marked as read' });
  }
  
  return res.status(404).json({ message: 'Notification not found' });
}

export async function markAllNotificationsAsReadController(req, res) {
  const userId = req.user.id;
  await markAllNotificationsAsReadModel(userId);
  return res.json({ message: 'All notifications marked as read' });
}

// TRANSACTIONS

export async function getClientTransactionsController(req, res) {
  try {
    const { status } = req.params;
    const clientId = req.user.id; // From JWT

    const transactions = await getClientTransactionsByStatusModel(clientId, status);
    
    res.status(200).json(transactions);
  } catch (error) {
    console.error("Error fetching client transactions:", error);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
}

export async function searchClientTransactionsController(req, res) {
  try {
    const { searchTerm, status } = req.params;
    const clientId = req.user.id;

    const transactions = await searchClientTransactionsModel(clientId, searchTerm, status);
    
    res.status(200).json(transactions);
  } catch (error) {
    console.error("Error searching transactions:", error);
    res.status(500).json({ message: "Failed to search transactions" });
  }
}

export async function getClientTransactionTimelineController(req, res) {
  try {
    const { transactionId } = req.params;
    const clientId = req.user.id;

    const timeline = await getClientTransactionTimelineModel(transactionId, clientId);

    if (!timeline) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    
    res.status(200).json(timeline);
  } catch (error) {
    console.error("Error fetching timeline:", error);
    res.status(500).json({ message: "Failed to fetch timeline" });
  }
}

export async function cancelClientTransactionController(req, res) {
  try {
    const { transactionId, reason } = req.body;
    const clientId = req.user.id;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({ 
        message: "Cancellation reason is required (minimum 10 characters)" 
      });
    }

    await cancelClientTransactionModel(transactionId, clientId, reason);
    
    res.status(200).json({ 
      message: "Transaction cancelled successfully",
      success: true 
    });
  } catch (error) {
    console.error("Error cancelling transaction:", error);
    res.status(400).json({ 
      message: error.message || "Failed to cancel transaction" 
    });
  }
}

export async function getClientTransactionReceiptController(req, res) {
  try {
    const { transactionId } = req.params;
    const clientId = req.user.id; // From JWT middleware

    const receiptData = await getClientTransactionReceiptModel(transactionId, clientId);

    if (!receiptData) {
      return res.status(404).json({ 
        message: "Transaction not found or not available for receipt generation. Only claimed or completed transactions can generate receipts." 
      });
    }

    res.status(200).json(receiptData);
  } catch (error) {
    console.error("Error fetching transaction receipt:", error);
    res.status(500).json({ message: "Failed to fetch transaction receipt" });
  }
}
