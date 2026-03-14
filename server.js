import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';

import { initializeSocketIO, getIO } from './src/config/socket.js';
import { applyExpiredClaimPenaltiesModel } from './src/model/walkInModel.js';

import { db } from './src/config/db.js';

// Routes
import userRoutes   from './src/routes/userRoutes.js';
import clientRoutes from './src/routes/clientRoutes.js';
import adminRoutes  from './src/routes/adminRoutes.js';
import chatRoutes   from './src/routes/chatRoutes.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const IS_PROD = process.env.NODE_ENV === 'production';

const app    = express();
const server = http.createServer(app);

// Socket.IO
const io = initializeSocketIO(server);

// Trust Railway's reverse proxy
app.set("trust proxy", 1);

// CORS 
const allowedOrigins = IS_PROD
  ? (process.env.ALLOWED_ORIGINS || process.env.APP_URL || '').split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (Postman, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


// Body Parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Auth Brute-Force Rate Limiter
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,   
  max: 20,                      
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests from this IP, please try again later.' },
  skip: (req) => {
    const authPaths = ['/login', '/signup', '/verifyOTP', '/forgotPassword', '/resend-otp'];
    return !authPaths.some(p => req.path.includes(p));
  }
});
app.use('/api/user', authLimiter);




const globalLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 200, 

  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    res.status(429).sendFile(path.join(__dirname, "public/pages/badrequest.html"));
  }
});

app.use(globalLimiter);

// Static File Serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 7. API Routes
app.use('/api/user',   userRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/admin',  adminRoutes);
app.use('/api/chat',   chatRoutes);


// Health Check
app.get('/health', async (_req, res) => {
  let dbStatus = 'ok';
  try {
    await db.execute('SELECT 1');
  } catch {
    dbStatus = 'error';
  }
  res.status(200).json({
    status: 'OK',
    db: dbStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Root Entry Point
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'index.html'));
});

app.get('/ticket/:token', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'ticket.html'));
});

// 404 Handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API route not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', 'pages', '404.html'));
});

// Global Error Handler 
app.use((err, _req, res, _next) => {
  // CORS errors
  if (err.message && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({ message: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ── CRON 1: Walk-in claim penalty (every midnight) ────────────────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    const count = await applyExpiredClaimPenaltiesModel();
    if (count > 0) {
      console.log(`[Cron] Walk-in penalties applied: ${count} expired transaction(s)`);
      getIO().to('admins').emit('admin_notification', {
        type:      'penalties_applied',
        title:     'Penalty Fees Applied',
        message:   `₱200 penalty applied to ${count} transaction(s).`,
        timestamp: new Date(),
      });
      getIO().to('admins').emit('admin_refresh', { area: 'walkin_transactions' });
    }
  } catch (err) {
    console.error('[Cron] Walk-in penalty error:', err);
  }
});


// ── CRON 2: Anonymize deleted accounts after 7-day grace period (every midnight)
cron.schedule('0 0 * * *', async () => {
  try {
    const [due] = await db.execute(
      `SELECT id, username
       FROM users
       WHERE deleted_at IS NOT NULL
         AND deleted_at <= NOW() - INTERVAL 7 DAY`
    );

    if (due.length === 0) return;

    const ids          = due.map((u) => u.id);
    const placeholders = ids.map(() => '?').join(', ');

    await db.execute(
      `UPDATE users
       SET
         email             = NULL,
         phone_number      = NULL,
         first_name        = 'Deleted',
         last_name         = 'User',
         middle_name       = NULL,
         picture           = NULL,
         username          = CONCAT('deleted_user_', id),
         password          = NULL,
         verification_code = NULL,
         token_id          = NULL,
         sex               = NULL,
         is_active         = 0,
         is_verified       = 0,
         is_online         = 0,
         deleted_at        = NOW()
       WHERE id IN (${placeholders})`,
      ids
    );

    // FIX: was `connection.execute` — `connection` was never declared in this scope
    for (const u of due) {
      await db.execute(
        `INSERT INTO audit_logs (actor_role, target_id, action, details, category)
         VALUES ('System', ?, 'Account Successfully Anonymized',
                 'Scheduled anonymization completed after 7 days',
                 'Anonymization')`,
        [u.id]
      );
    }

    getIO().to('admins').emit('admin_refresh', { area: 'clients' });

    console.log(
      `[Cron] Anonymized ${due.length} account(s): ` +
      due.map((u) => `${u.username} (#${u.id})`).join(', ')
    );
  } catch (err) {
    console.error('[Cron] Account anonymization error:', err);
  }
});


// ── CRON 3: Auto-lapse overdue appointments (every midnight) ──────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    const [result] = await db.execute(
      `UPDATE appointments
       SET status  = 'lapsed',
           remarks = 'Automatically lapsed — appointment date passed'
       WHERE status IN ('pending', 'approved')
         AND CONCAT(appointment_date, ' ', appointment_time) < NOW() - INTERVAL 30 MINUTE`
    );

    if (result.affectedRows > 0) {
      console.log(`[Cron] Lapsed ${result.affectedRows} appointment(s)`);

      const [lapsed] = await db.execute(
        `SELECT appointment_id, client_id, appointment_date, appointment_time
         FROM appointments
         WHERE status = 'lapsed'
           AND updated_at >= NOW() - INTERVAL 1 MINUTE`
      );

      const io = getIO();
      for (const appt of lapsed) {
        await db.execute(
          `INSERT IGNORE INTO notifications (user_id, type, title, message, related_id)
           VALUES (?, 'appointment', 'Appointment Lapsed', ?, ?)`,
          [
            appt.client_id,
            `Your appointment on ${appt.appointment_date} at ${appt.appointment_time} has lapsed.`,
            appt.appointment_id,
          ]
        );

        io.to(`user_${appt.client_id}`).emit('notification', {
          type:    'appointment',
          title:   'Appointment Lapsed',
          message: `Your appointment on ${new Date(`${appt.appointment_date}T${appt.appointment_time}`).toLocaleString('en-PH')} has lapsed.`,
        });
      }

      io.to('admins').emit('admin_notification', {
        type:      'appointments_lapsed',
        title:     'Appointments Auto-Lapsed',
        message:   `${result.affectedRows} appointment(s) were automatically lapsed.`,
        timestamp: new Date(),
      });
      io.to('admins').emit('admin_refresh', { area: 'appointments' });
    }
  } catch (err) {
    console.error('[Cron] Lapse error:', err);
  }
});

// ── CRON 4: Upcoming appointment reminders (daily at 8 AM) ───────────────────
cron.schedule('0 8 * * *', async () => {
  try {
    const [upcoming] = await db.execute(
      `SELECT appointment_id, client_id, appointment_date, appointment_time
       FROM appointments
       WHERE status = 'approved'
         AND DATE(appointment_date) = DATE(NOW() + INTERVAL 1 DAY)`
    );

    const io = getIO();
    for (const appt of upcoming) {
      await db.execute(
        `INSERT IGNORE INTO notifications (user_id, type, title, message, related_id)
         VALUES (?, 'appointment', 'Appointment Reminder', ?, ?)`,
        [
          appt.client_id,
          `Reminder: You have an appointment tomorrow (${appt.appointment_date}) at ${appt.appointment_time}.`,
          appt.appointment_id,
        ]
      );

      io.to(`user_${appt.client_id}`).emit('notification', {
        type:    'appointment_reminder',
        title:   'Appointment Tomorrow',
        message: `Reminder: Your appointment is tomorrow at ${appt.appointment_time}. Please arrive 10 minutes early.`,
      });
    }

    if (upcoming.length > 0)
      console.log(`[Cron] Sent reminders for ${upcoming.length} appointment(s)`);
  } catch (err) {
    console.error('[Cron] Reminder error:', err);
  }
});

// SERVER START
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running  → http://localhost:${PORT}`);
  console.log(`Environment     → ${process.env.NODE_ENV || 'development'}`);
  console.log(`Socket.IO       → initialized`);
  console.log(`Flutter-ready   → mobile origins allowed`);
});

// Graceful Shutdown 
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forcing shutdown after timeout.');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

export { app, server, io };
