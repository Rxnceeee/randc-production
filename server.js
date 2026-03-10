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
  windowMs: 5 * 60 * 1000, 
  max: 300, 

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


// CRON JOBS
// Walk-in claim penalty (every midnight)
cron.schedule('0 0 * * *', async () => {
  try {
    const count = await applyExpiredClaimPenaltiesModel();
    if (count > 0) {
      console.log(`Walk-in penalties applied: ${count} expired transactions`);
      // Real-time: admins get a dashboard refresh signal
      getIO().emit('admin_refresh', { area: 'walkin_transactions' });
    }
  } catch (err) {
    console.error('Walk-in penalty cron error:', err);
  }
});

// Hard-delete accounts whose 7-day grace period has elapsed (every midnight)
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
      `DELETE FROM users WHERE id IN (${placeholders})`,
      ids
    );

    getIO().emit('admin_refresh', { area: 'clients' });

    console.log(
      ` Permanently deleted ${due.length} account(s): ` +
      due.map((u) => `${u.username} (#${u.id})`).join(', ')
    );
  } catch (err) {
    console.error('Account purge cron error:', err);
  }
});
// Auto-lapse overdue appointments (every midnight) 
cron.schedule('0 0 * * *', async () => {
  try {
    const [result] = await db.execute(
      `UPDATE appointments
       SET status = 'lapsed', remarks = 'Automatically lapsed — appointment date passed'
       WHERE status IN ('pending', 'approved')
         AND CONCAT(appointment_date, ' ', appointment_time) < NOW() - INTERVAL 30 MINUTE`
    );

    if (result.affectedRows > 0) {
      console.log(` Lapsed ${result.affectedRows} appointment(s)`);

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

        // Real-time to affected client
        io.to(`user_${appt.client_id}`).emit('notification', {
          type: 'appointment',
          title: 'Appointment Lapsed',
          message: `Your appointment on ${new Date(`${appt.appointment_date}T${appt.appointment_time}`).toLocaleString('en-PH')} has lapsed.`,
        });
      }

      // Real-time to admin room
      io.to('admins').emit('admin_notification', {
        type: 'appointments_lapsed',
        title: 'Appointments Auto-Lapsed',
        message: `${result.affectedRows} appointment(s) were automatically lapsed.`,
        timestamp: new Date(),
      });

      io.to('admins').emit('admin_refresh', { area: 'appointments' });
    }
  } catch (err) {
    console.error('Lapse cron error:', err);
  }
});

// Apply 200 penalty to unclaimed documents (every midnight) 
cron.schedule('0 0 * * *', async () => {
  try {
    const [expired] = await db.execute(
      `SELECT dpt.transaction_id, dpt.client_id, s.service_name
       FROM document_process_transaction dpt
       INNER JOIN status st ON dpt.current_status_id = st.status_id
       INNER JOIN services s ON dpt.service_id = s.service_id
       WHERE st.status_name = 'to_claim'
         AND dpt.claim_deadline < NOW()
         AND dpt.has_penalty = 0`
    );

    if (expired.length === 0) return;

    const io = getIO();
    for (const tx of expired) {
      await db.execute(
        `UPDATE document_process_transaction
         SET penalty_amount = 200.00, has_penalty = 1
         WHERE transaction_id = ?`,
        [tx.transaction_id]
      );
      await db.execute(
        `INSERT INTO notifications (user_id, type, title, message, related_id)
         VALUES (?, 'penalty_notice', 'Penalty Fee Applied', ?, ?)`,
        [
          tx.client_id,
          `A ₱200.00 penalty has been applied to your ${tx.service_name} transaction for not claiming within 7 days.`,
          tx.transaction_id,
        ]
      );

      // Real-time to affected client
      io.to(`user_${tx.client_id}`).emit('notification', {
        type: 'penalty_notice',
        title: 'Penalty Fee Applied',
        message: `₱200 penalty applied to ${tx.service_name} — document not claimed within 7 days.`,
      });
    }

    // Real-time to admin room
    io.to('admins').emit('admin_notification', {
      type: 'penalties_applied',
      title: 'Penalty Fees Applied',
      message: `₱200 penalty applied to ${expired.length} transaction(s).`,
      timestamp: new Date(),
    });

    io.to('admins').emit('admin_refresh', { area: 'transactions' });
    console.log(`  Applied ₱200 penalty to ${expired.length} transaction(s)`);
  } catch (err) {
    console.error('Penalty cron error:', err);
  }
});

// Upcoming appointment reminders (daily at 8 AM) 
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
        type: 'appointment_reminder',
        title: 'Appointment Tomorrow',
        message: `Reminder: Your appointment is tomorrow at ${appt.appointment_time}. Please arrive 10 minutes early.`,
      });
    }

    if (upcoming.length > 0)
      console.log(`Sent reminders for ${upcoming.length} upcoming appointment(s)`);
  } catch (err) {
    console.error('Reminder cron error:', err);
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
