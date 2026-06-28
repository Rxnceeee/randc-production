import crypto from 'crypto';
import QRCode from 'qrcode';
import {
  getActiveServicesModel,
  getSlotsByDateModel,
  checkSlotCapacityModel,
  validateServicesExistModel,
  isHolidayModel,
  createPublicBookingModel,
  getPublicBookingByTokenModel,
} from '../model/publicModel.js';
import { sendPublicBookingConfirmation } from '../services/emailService.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE  = /^[A-Za-z\s\-]+$/;
const PHONE_RE = /^(\+?63|0)[0-9]{9,10}$/;

export async function getServices(req, res) {
  try {
    const services = await getActiveServicesModel();
    return res.status(200).json({ services });
  } catch (error) {
    console.error('[publicController] getServices:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getSlots(req, res) {
  try {
    const { date } = req.query;
    if (!date)
      return res.status(400).json({ message: 'date query param is required.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(date) < today)
      return res.status(400).json({ message: 'Cannot query slots for a past date.' });

    const rows = await getSlotsByDateModel(date);
    const slots = rows.map(r => ({
      time:            r.appointment_time,
      maxCapacity:     r.max_capacity,
      currentBookings: r.current_bookings,
      remaining:       r.remaining,
      isAvailable:     Boolean(r.is_available),
    }));
    return res.status(200).json({ slots });
  } catch (error) {
    console.error('[publicController] getSlots:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function submitBooking(req, res) {
  try {
    const { firstName, lastName, email, phone,
            serviceIds, appointmentDate, appointmentTime, notes } = req.body;

    if (!firstName || typeof firstName !== 'string'
        || firstName.trim().length < 2 || firstName.trim().length > 50
        || !NAME_RE.test(firstName.trim()))
      return res.status(400).json({ message: 'First name must be 2–50 letters.' });

    if (!lastName || typeof lastName !== 'string'
        || lastName.trim().length < 2 || lastName.trim().length > 50
        || !NAME_RE.test(lastName.trim()))
      return res.status(400).json({ message: 'Last name must be 2–50 letters.' });

    if (!email || !EMAIL_RE.test(email))
      return res.status(400).json({ message: 'A valid email address is required.' });

    if (phone && !PHONE_RE.test(phone))
      return res.status(400).json({ message: 'Invalid phone number format.' });

    if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 7
        || !serviceIds.every(id => Number.isInteger(id) && id > 0))
      return res.status(400).json({ message: 'Select 1–7 valid services.' });

    if (!appointmentDate || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate))
      return res.status(400).json({ message: 'Invalid appointment date.' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const apptDate = new Date(appointmentDate);
    if (apptDate < today)
      return res.status(400).json({ message: 'Appointment date cannot be in the past.' });
    if (apptDate.getDay() === 0)
      return res.status(400).json({ message: 'Appointments are not available on Sundays.' });

    if (!appointmentTime || !/^\d{1,2}:\d{2}$/.test(appointmentTime))
      return res.status(400).json({ message: 'Invalid appointment time format.' });

    if (notes && notes.length > 500)
      return res.status(400).json({ message: 'Notes must be 500 characters or fewer.' });

    const holiday = await isHolidayModel(appointmentDate);
    if (holiday)
      return res.status(400).json({ message: 'The selected date is a holiday.' });

    const validServices = await validateServicesExistModel(serviceIds);
    if (validServices.length !== serviceIds.length)
      return res.status(400).json({ message: 'One or more selected services are invalid.' });

    const slotCheck = await checkSlotCapacityModel(appointmentDate, appointmentTime);
    if (!slotCheck.hasRoom)
      return res.status(409).json({ message: 'This time slot is fully booked. Please choose another.' });

    const trackingToken = crypto.randomBytes(32).toString('hex');
    await createPublicBookingModel({
      trackingToken,
      email,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      phone:     phone || null,
      appointmentDate,
      appointmentTime,
      notes:     notes || null,
      serviceIds,
    });

    const trackingUrl  = `${process.env.APP_URL}/track/${trackingToken}`;
    const qrBuffer     = await QRCode.toBuffer(trackingUrl, { width: 300, margin: 2 });
    const bookingRef   = trackingToken.slice(-8).toUpperCase();
    const serviceNames = validServices.map(s => s.service_name);

    sendPublicBookingConfirmation({
      email,
      firstName:       firstName.trim(),
      lastName:        lastName.trim(),
      appointmentDate,
      appointmentTime,
      services:        serviceNames,
      trackingUrl,
      qrBuffer,
      bookingRef,
    }).catch(err => console.error('[email] sendPublicBookingConfirmation failed:', err));

    return res.status(200).json({
      success: true,
      message: 'Booking confirmed. Check your email for your QR code.',
    });
  } catch (error) {
    console.error('[publicController] submitBooking:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function trackBooking(req, res) {
  try {
    const { token } = req.params;
    if (!token || token.length !== 64)
      return res.status(404).json({ message: 'Booking not found.' });

    const booking = await getPublicBookingByTokenModel(token);
    if (!booking)
      return res.status(404).json({ message: 'Booking not found.' });

    return res.status(200).json(booking);
  } catch (error) {
    console.error('[publicController] trackBooking:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
