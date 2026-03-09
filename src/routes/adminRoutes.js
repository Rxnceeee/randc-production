import express from 'express';
import {
  getScheduleForecastController,
  fetchAllServices,
  getAllUsersController,
  createService,
  updateService,
  getDashboardStatsController,
  updateServiceStatus,
  searchServices,
  getAppointments,
  getAppointmentServicesController,
  completeAppointmentController,
  getTransactionReportController,
  searchAppointmentsController,
  getDocumentTransactionsController,
  getWalkinDocumentTransactionsController,
  searchDocumentTransactionsController,
  getTransactionTimelineController,
  updateTransactionStatusController,
  getAllStatusesController,
  banClientController,
  unbanClientController,
  getClientsController,
  getClientFullHistoryController,
  createWalkInController,
  searchClientWalkInController,
  createAdminAppointmentController,
  getAppointmentForecastDetail,
  getTestimonialsAdminController,
  setTransactionReadyController,
} from '../controller/adminController.js';
import { isUserAuthenticated, verifyAccessRole } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

const ALLOWED_IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif)$/i;
const ALLOWED_IMAGE_MIMETYPES  = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
]);

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; 
const MAX_IMAGE_COUNT      = 5;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads/transaction_photos/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'transaction-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize:  MAX_IMAGE_SIZE_BYTES,
    files:     MAX_IMAGE_COUNT,
  },
  fileFilter: (req, file, cb) => {
    const validExt  = ALLOWED_IMAGE_EXTENSIONS.test(path.extname(file.originalname));
    const validMime = ALLOWED_IMAGE_MIMETYPES.has(file.mimetype);

    if (validExt && validMime) return cb(null, true);

    const isVideo = file.mimetype.startsWith('video/');
    const isAudio = file.mimetype.startsWith('audio/');
    let reason = 'Only image files are allowed (JPEG, PNG, GIF).';
    if (isVideo) reason = 'Video files are not supported. Please upload images only (JPEG, PNG, GIF).';
    if (isAudio) reason = 'Audio files are not supported. Please upload images only (JPEG, PNG, GIF).';

    const err  = new Error(reason);
    err.code   = 'INVALID_FILE_TYPE';
    cb(err, false);
  },
});

function handleUploadError(err, req, res, next) {
  if (!err) return next();

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      message: `One or more images exceed the 5 MB limit. Please compress or resize before uploading.`,
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      message: `You can upload a maximum of ${MAX_IMAGE_COUNT} images at once.`,
    });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ message: 'Unexpected file field received.' });
  }
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(415).json({ message: err.message });
  }

  return res.status(400).json({ message: err.message || 'File upload failed.' });
}

router.put(
  '/updateTransactionStatus',
  isUserAuthenticated,
  verifyAccessRole(['admin', 'staff']),
  (req, res, next) => {
    upload.array('images', MAX_IMAGE_COUNT)(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  updateTransactionStatusController
);


// CLIENT MANAGEMENT 
router.get('/clients',isUserAuthenticated,verifyAccessRole('admin'),getClientsController);
router.get('/clients/:userId/history',isUserAuthenticated,verifyAccessRole('admin'),getClientFullHistoryController);
router.post('/clients/:userId/ban',isUserAuthenticated,verifyAccessRole('admin'),banClientController);
router.post('/clients/:userId/unban',isUserAuthenticated,verifyAccessRole('admin'),unbanClientController);

// WALK-IN TRANSACTIONS 
router.get('/walkin/search-client',isUserAuthenticated,verifyAccessRole('admin'),searchClientWalkInController);
router.post('/walkin/create',isUserAuthenticated,verifyAccessRole('admin'),createWalkInController);

// MANUAL APPOINTMENT 
router.post('/appointments/manual',isUserAuthenticated,verifyAccessRole('admin'),createAdminAppointmentController);

// SCHEDULE FORECAST DETAIL 
router.get('/appointments/:appointmentId/detail',isUserAuthenticated,verifyAccessRole('admin'),getAppointmentForecastDetail);

// TRANSACTION — MARK READY 
router.post('/transactions/:transactionId/set-ready',isUserAuthenticated,verifyAccessRole('admin'),setTransactionReadyController);

// TESTIMONIALS 
router.get('/testimonials',isUserAuthenticated,verifyAccessRole('admin'),getTestimonialsAdminController);

//admin dashboard
router.get('/getDashboardStats',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),getDashboardStatsController);


router.post('/saveService',isUserAuthenticated,verifyAccessRole('admin'),createService)
router.get('/getAllServices',isUserAuthenticated,verifyAccessRole('admin'), fetchAllServices);

router.get('/getAllUsers/:role',isUserAuthenticated,verifyAccessRole('admin'), getAllUsersController);

router.get('/searchService/:searchWord',isUserAuthenticated,verifyAccessRole('admin'),searchServices)
router.put('/saveService/:id',isUserAuthenticated,verifyAccessRole('admin'),updateService)
router.put('/toggleServiceStatus',isUserAuthenticated,verifyAccessRole('admin'),updateServiceStatus)
router.get('/filterAppointments/:status',isUserAuthenticated,verifyAccessRole('admin'), getAppointments);

// All routes require admin or staff authentication
router.get('/getDocumentTransactions/:status',isUserAuthenticated, verifyAccessRole(['admin', 'staff']), getDocumentTransactionsController);
router.get('/getWalkinDocumentTransactions',isUserAuthenticated, verifyAccessRole(['admin', 'staff']), getWalkinDocumentTransactionsController);

router.get('/searchDocumentTransaction/:searchTerm/:status',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),searchDocumentTransactionsController);
router.get('/getTransactionTimeline/:transactionId',isUserAuthenticated, verifyAccessRole(['admin', 'staff']), getTransactionTimelineController);
router.put('/updateTransactionStatus',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),upload.array('images', 5),updateTransactionStatusController);
router.get('/getAllStatuses', isUserAuthenticated,  verifyAccessRole(['admin', 'staff']),  getAllStatusesController);

router.get('/getTransactionReport/:transactionId',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),getTransactionReportController);

// appointment services 
router.get('/getAppointmentServices/:appointmentId',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),getAppointmentServicesController);
router.post('/completeAppointment',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),completeAppointmentController);
router.get('/searchAppointments/:searchTerm/:status', isUserAuthenticated, verifyAccessRole(['admin', 'staff']), searchAppointmentsController);

router.get('/getScheduleForecast/:startDate/:endDate',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),getScheduleForecastController);

export default router;


