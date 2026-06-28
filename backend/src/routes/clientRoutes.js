import express from 'express';
import { setupAccountController, getDashboardStatsController,
      submitTestimonialController,
  getPublicTestimonialsController,
  checkTestimonialEligibilityController,
  getMyTestimonialsController,
    getRecentActivityController,getUpcomingAppointmentsController,getActiveTransactionsController,getMonthlyOverviewController,getClientTransactionsController,searchClientTransactionsController,getClientTransactionTimelineController,cancelClientTransactionController,getClientTransactionReceiptController,getAvailableTimeSlotsController,markAllNotificationsAsReadController,markNotificationAsReadController,getNotificationsController,getAppointmentsController ,submitAppointmentController,changePasswordController, cancelClientAppointmentController} from '../controller/clientController.js';
import {isUserAuthenticated,verifyAccessRole} from  '../middleware/auth.js';
import { requestAccountAnonymization } from '../controller/userController.js';
import { getClosedDatesController } from '../controller/adminController.js';

const router = express.Router();

router.get('/closed-dates',isUserAuthenticated,verifyAccessRole('client'),getClosedDatesController);
// ── TESTIMONIALS ──────────────────────────────────────────────
// Public — no auth needed
router.get('/testimonials/public',getPublicTestimonialsController);
router.post('/testimonials',isUserAuthenticated,verifyAccessRole('client'),submitTestimonialController);
router.get('/testimonials/eligible',isUserAuthenticated,verifyAccessRole('client'),checkTestimonialEligibilityController);
router.get('/testimonials/mine',isUserAuthenticated,verifyAccessRole('client'),getMyTestimonialsController);

// ── ACCOUNT ANONYMIZATION ──────────────────────────────────────────
router.post('/account/anonymize',isUserAuthenticated,requestAccountAnonymization);


router.put('/setupAccount', isUserAuthenticated,setupAccountController);
router.put('/changePassword',isUserAuthenticated,verifyAccessRole('client'),changePasswordController)

// appointment
router.get('/getAppointments/:status',isUserAuthenticated,verifyAccessRole('client'),getAppointmentsController)
router.post('/submitAppointment',isUserAuthenticated,verifyAccessRole('client'),submitAppointmentController)
router.put('/cancelAppointment/:appointmentID',isUserAuthenticated,verifyAccessRole('client'),cancelClientAppointmentController)


// Time Slot Management
router.get('/available-time-slots', isUserAuthenticated, verifyAccessRole( ['client','admin']), getAvailableTimeSlotsController);

// Notification Management
router.get('/notifications', isUserAuthenticated, verifyAccessRole('client'), getNotificationsController);
router.put('/notifications/:id/read', isUserAuthenticated, verifyAccessRole('client'), markNotificationAsReadController);
router.put('/notifications/mark-all-read', isUserAuthenticated, verifyAccessRole('client'), markAllNotificationsAsReadController);

//transaction

// Client can only get their own transaction receipts

router.get('/getClientTransactions/:status',isUserAuthenticated,verifyAccessRole(['client']),getClientTransactionsController);
router.get('/searchClientTransactions/:searchTerm/:status',isUserAuthenticated,verifyAccessRole(['client']),searchClientTransactionsController);
router.get('/getClientTransactionTimeline/:transactionId',isUserAuthenticated,verifyAccessRole(['client']),getClientTransactionTimelineController);
router.post('/cancelClientTransaction',isUserAuthenticated,verifyAccessRole(['client']),cancelClientTransactionController);
router.get('/getTransactionReceipt/:transactionId',isUserAuthenticated,verifyAccessRole(['client']),getClientTransactionReceiptController);

// ==========================================
// BACKEND API ENDPOINTS FOR DASHBOARD
// ==========================================

router.get('/getDashboardStats', isUserAuthenticated, verifyAccessRole('client'), getDashboardStatsController);
router.get('/getRecentActivity', isUserAuthenticated, verifyAccessRole('client'), getRecentActivityController);
router.get('/getUpcomingAppointments', isUserAuthenticated, verifyAccessRole('client'), getUpcomingAppointmentsController);
router.get('/getActiveTransactions', isUserAuthenticated, verifyAccessRole('client'), getActiveTransactionsController);
router.get('/getMonthlyOverview', isUserAuthenticated, verifyAccessRole('client'), getMonthlyOverviewController);

export default router;