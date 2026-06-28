import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getServices,
  getSlots,
  submitBooking,
  trackBooking,
} from '../controller/publicController.js';

const router = Router();

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many booking attempts. Please wait 15 minutes before trying again.' },
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

router.get('/services',     readLimiter,    getServices);
router.get('/slots',        readLimiter,    getSlots);
router.post('/book',        bookingLimiter, submitBooking);
router.get('/track/:token', readLimiter,    trackBooking);

export default router;
