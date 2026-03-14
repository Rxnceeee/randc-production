// magicLinkController.js
import {
  getUserByEmail,
  getUserById,
} from '../model/userModel.js';
import {
  generateRawToken,
  saveMagicTokenModel,
  findValidMagicTokenModel,
  consumeMagicTokenModel,
  countRecentMagicTokensModel,
} from '../model/magicLinkModel.js';

import { insertAuditLogsModel} from '../model/auditLogModel.js';
import {reverseAnonymizationAccountModel} from '../model/userModel.js'
import { sendMagicLinkEmail } from '../services/emailService.js';
import { generateJWT }        from '../middleware/auth.js';

// Config
const TOKEN_TTL_MIN  = 15;   // link expires after 15 min
const RATE_LIMIT_MAX = 3;    // max sends per window
const RATE_LIMIT_WIN = 10;   // window in minutes

// POST /api/user/magic-link/send
export async function sendMagicLinkController(req, res) {
  try {
    const raw = req.body.email;

    // 1. Input validation
    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ message: 'Email address is required.' });
    }
    const email = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }

    // 2. Look up user — returns null if not found (fixed getUserByEmail)
    const userId = await getUserByEmail(email);
    if (!userId) {
      return res.status(401).json({
        message: 'Gmail address is not associated with any account!',
      });
    }

    // 3. Fetch full user row
    const user = await getUserById(userId);
    if (!user) {
      return res.status(401).json({ message: 'Account not found.' });
    }

    // 4. Guard: inactive account
    if (user.is_banned) {
      return res.status(403).json({ message: 'Your account is currently banned.' });
    }

    // 5. Guard: unverified
    if (!user.is_verified) {
      return res.status(400).json({
        message: 'Your account is not verified yet. Please complete email verification first.',
      });
    }

    // 6. Guard: role check
    if (!['client', 'admin'].includes(user.role)) {
      return res.status(403).json({
        message: 'Magic link login is not available for this account type.',
      });
    }

    // 7. Rate limit — 3 sends per 10 min
    const recentCount = await countRecentMagicTokensModel(userId, RATE_LIMIT_WIN);
    if (recentCount >= RATE_LIMIT_MAX) {
      return res.status(429).json({
        message: `Too many login link requests. Please wait ${RATE_LIMIT_WIN} minutes before trying again.`,
        rateLimited: true,
      });
    }

    // 8. Generate, save, send
    const rawToken  = generateRawToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000);

    await saveMagicTokenModel(userId, rawToken, expiresAt);

    const magicUrl = `${process.env.APP_URL || 'http://localhost:3000'}/?magic=${rawToken}`;
    await sendMagicLinkEmail({
      email,
      name:     user.first_name || user.username,
      magicUrl,
      expiresAt,
      deleted_at:user.deleted_at,
    });

    await insertAuditLogsModel({
      actor_id: user.id,
      actor_role: 'Client',
      target_id: user.id,
      action: 'Magic Link Sent',
      details: `Magic login link sent to ${user.email} at IP ${req.ip}`,
      category: 'Email'
    });

    console.log(`Magic link sent → ${email} [user #${userId}]`);
    return res.status(200).json({
      message: 'Login link sent! Check your inbox — it expires in 15 minutes.',
    });

  } catch (err) {
    console.error('sendMagicLink error:', err);
    return res.status(500).json({ message: 'Server error. Please try again later.' });
  }
}

// GET /api/user/magic-link/verify?token=<raw>
export async function verifyMagicLinkController(req, res) {
  try {
    const { token } = req.query;
    // 1. Shape check — must be 64-char hex
    if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ message: 'Invalid or missing token.' });
    }

    // 2. Find by hash — checks unused + not expired in one query
    const record = await findValidMagicTokenModel(token);
    if (!record) {
      await insertAuditLogsModel({
        actor_id: null,
        actor_role: 'System',
        target_id: null,
        action: 'Magic Link Verification Failed',
        details: `Expired or invalid magic login link attempt`,
        category: 'Authentication'
      });
      return res.status(401).json({
        message: 'This login link is invalid, has already been used, or has expired.',
        expired: true,
      });
    }

    // 3. Consume BEFORE issuing JWT — prevents double-click race condition
    await consumeMagicTokenModel(record.id);

    // 4. Fresh user data
    const user = await getUserById(record.user_id);
    if (!user || user.is_banned) {
      return res.status(401).json({
        message: 'Account not found or has been deactivated.',
      });
    }

    // IF USER HAS REQUEST FOR ANONYMIZE REVERSE CHANGES
    if(user.deleted_at){
      await reverseAnonymizationAccountModel(user.id)
     
    }

    // 5. Issue JWT (same shape as loginUser)
    const jwtToken = generateJWT(user);
    await insertAuditLogsModel({
      actor_id: user.id,
      actor_role: 'Client',
      target_id: user.id,
      action: 'Magic Link Consumed',
      details: `User successfully logged in using a magic link at ${req.ip}`,
      category: 'Authentication'
    });

    console.log(`Magic link verified — user #${user.id} (${user.username})`);

    
    return res.status(200).json({
      message: 'Login successful.',
      token:   jwtToken,
      user,
    });

  } catch (err) {
    console.error('verifyMagicLink error:', err);
    return res.status(500).json({ message: 'Server error. Please try again later.' });
  }
}
