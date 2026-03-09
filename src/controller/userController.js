// userController.js — v2 (Login Cooldown, OTP Anti-Spam, Account Deletion)
import {
  verifyUsername, verifyEmail, saveUser, verifyAccountStatus, clearOTP,
  getUserById, getUserCridentials, changeClientPassword, getUserByEmail,
  incrementLoginAttempts, setLoginCooldown, resetLoginAttempts,
  incrementOtpAttempts, setOtpLock, getOTP,
  softDeleteAccountModel, hasActiveTransactionsModel, hasActiveAppointmentsModel,
  banUserModel, checkActiveBanModel
} from '../model/userModel.js';
import { hashPassword, comparePassword } from '../services/authService.js';
import { generateOTP, saveUserOTP, verifyUserOTP } from '../services/otpService.js';
import { sendUserOTP } from '../services/emailService.js';
import { generateJWT } from '../middleware/auth.js';
import { isValidUsername,isValidEmail,isValidPassword } from '../utils/validator.js';
import { getIO, emitToAdmins } from '../config/socket.js';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_COOLDOWN_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MINUTES = 10;

// LOGIN
export async function loginUser(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const userCredentials = await getUserCridentials(username);

    if (!userCredentials) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if account is soft-deleted
    if (userCredentials.deleted_at) {
      return res.status(401).json({ message: 'This account has been deleted' });
    }

    // Check role
    if (!['client', 'staff','admin'].includes(userCredentials.role)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check verification
    if (!userCredentials.is_verified) {
      return res.status(401).json({ message: 'Account not verified. Please check your email.' });
    }

    // ── BAN CHECK ─────────────────────────────────────────────
    const activeBan = await checkActiveBanModel(userCredentials.id);
    if (activeBan) {
      const msg = activeBan.ban_type === 'permanent'
        ? 'Your account has been permanently banned.'
        : `Your account is banned until ${new Date(activeBan.ban_until).toLocaleString('en-PH')}.`;
      return res.status(403).json({ message: msg, banned: true });
    }

    // ── LOGIN COOLDOWN CHECK ──────────────────────────────────
    if (userCredentials.login_cooldown_until) {
      const cooldownEnd = new Date(userCredentials.login_cooldown_until);
      if (cooldownEnd > new Date()) {
        const remaining = Math.ceil((cooldownEnd - new Date()) / 1000 / 60);
        return res.status(429).json({
          message: `Too many failed attempts. Please try again in ${remaining} minute(s).`,
          cooldown: true,
          cooldownUntil: cooldownEnd
        });
      } else {
        await resetLoginAttempts(userCredentials.id);
      }
    }

    // ── PASSWORD CHECK ────────────────────────────────────────
    const isMatch = await comparePassword(password, userCredentials.password);
    if (!isMatch) {
      const newAttempts = (userCredentials.login_attempts || 0) + 1;
      await incrementLoginAttempts(userCredentials.id);

      if (newAttempts >= LOGIN_MAX_ATTEMPTS) {
        const cooldownUntil = new Date(Date.now() + LOGIN_COOLDOWN_MINUTES * 60 * 1000);
        await setLoginCooldown(userCredentials.id, cooldownUntil);
        return res.status(429).json({
          message: `Too many failed attempts. Please try again in ${LOGIN_COOLDOWN_MINUTES} minutes.`,
          cooldown: true,
          cooldownUntil
        });
      }

      const remaining = LOGIN_MAX_ATTEMPTS - newAttempts;
      return res.status(401).json({
        message: `Invalid credentials. ${remaining} attempt(s) remaining.`
      });
    }

    // Success — reset attempts
    await resetLoginAttempts(userCredentials.id);

    const user = await getUserById(userCredentials.id);
    const token = generateJWT(user);
    return res.status(200).json({ message: 'Login successful', token, user });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// REGISTER
export async function signupUser(req, res) {
  try {

    let { username, email, password } = req.body;

    username = username?.trim();
    email = email?.trim().toLowerCase();
    password = password?.trim();

    // VALIDATE
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ message: 'Invalid username format' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Password must be 12–24 characters' });
    }

    const isValidUsernameUsed = await verifyUsername(username);
    if (isValidUsernameUsed) {
      return res.status(409).json({ message: 'Username already used!' });
    }

    const emailExists = await verifyEmail(email);
    if (emailExists) {
      return res.status(409).json({ message: 'Email address already used!' });
    }

    const hashedPassword = await hashPassword(password);
    const userID = await saveUser(username, hashedPassword, email);

    const otp = generateOTP();
    await saveUserOTP(userID, otp);
    await sendUserOTP(otp, email);

    emitToAdmins('admin_notification', {
      type: 'new_user_registered',
      title: 'New Account Registration',
      message: `New account Registration: ${username}`,
      timestamp: new Date()
    });

    return res.status(200).json({ userID, message: 'Sign up successful!' });

  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// VERIFY OTP
export async function verifyOTP(req, res) {
  try {
    const { userID, code } = req.body;
    const isValidOTP = await verifyUserOTP(userID, code);

    if (isValidOTP) {
      await verifyAccountStatus(userID);
      await clearOTP(userID);

      const user = await getUserById(userID);
      const token = generateJWT(user);

      // Notify admins
      emitToAdmins('admin_notification', {
        type: 'account_verified',
        title: 'Account Verified',
        message: `Account verified: ${user.username}`,
        timestamp: new Date()
      });

      return res.status(200).json({ message: 'Verification successful', token, user });
    } else {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }
  } catch (err) {
    console.error('OTP verify error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// RESEND OTP 
export async function resendOTP(req, res) {
  try {
    const { userID, email } = req.body;

    const [otpRecord] = await getOTP(userID);
    if (!otpRecord) return res.status(404).json({ message: 'User not found' });

    // Check if OTP lock is active
    if (otpRecord.otp_lock_until && new Date(otpRecord.otp_lock_until) > new Date()) {
      const remaining = Math.ceil((new Date(otpRecord.otp_lock_until) - new Date()) / 1000 / 60);
      return res.status(429).json({
        message: `Too many OTP requests. Please wait ${remaining} minute(s).`,
        locked: true,
        lockUntil: otpRecord.otp_lock_until
      });
    }

    // If OTP is still valid, don't generate a new one
    if (otpRecord.verification_code && otpRecord.code_expires_at) {
      const expiry = new Date(otpRecord.code_expires_at);
      if (expiry > new Date()) {
        const remainingSecs = Math.ceil((expiry - new Date()) / 1000);
        return res.status(429).json({
          message: 'Please wait until the current OTP expires.',
          otpStillValid: true,
          expiresIn: remainingSecs
        });
      }
    }

    // Check attempt count
    const attempts = (otpRecord.otp_attempts || 0) + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000);
      await setOtpLock(userID, lockUntil);
      return res.status(429).json({
        message: `Too many OTP requests. Please wait ${OTP_LOCK_MINUTES} minutes.`,
        locked: true,
        lockUntil
      });
    }

    // Generate new OTP
    await incrementOtpAttempts(userID);
    const otp = generateOTP();
    await saveUserOTP(userID, otp);
    await sendUserOTP(otp, email);

    return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('Resend OTP error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// FORGOT PASSWORD 
export async function forgotPassword(req, res) {
  try {
    const { email } = req.params;
    const isExist = await verifyEmail(email);
    if (!isExist) {
      return res.status(401).json({ message: 'Gmail address is not associated with any account!' });
    }

    const userID = await getUserByEmail(email);
    const otp = generateOTP();
    await saveUserOTP(userID, otp);
    await sendUserOTP(otp, email);

    return res.status(200).json({ userID, message: 'Verification code sent successfully!' });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

export async function verifyOTPForgotPassword(req, res) {
  try {
    const { userID, code } = req.body;
    const isValidOTP = await verifyUserOTP(userID, code);
    if (!isValidOTP) return res.status(400).json({ message: 'Invalid or expired verification code' });
    await clearOTP(userID);
    return res.status(200).json({ message: 'Verification successful' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
}

export async function updateNewPassword(req, res) {
  try {
    const { newPassword, userID } = req.body;
    if (!userID) return res.status(401).json({ message: 'Unauthorized' });
    const hashedPassword = await hashPassword(newPassword);
    await changeClientPassword(hashedPassword, userID);
    const user = await getUserById(userID);
    const token = generateJWT(user);
    return res.status(200).json({ message: 'Password changed successfully', token, user });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
}

export async function createNewPassword(req, res) {
  try {
    const { newPassword, currentPassword } = req.body;
    const userID = req.user?.id;
    const username = req.user?.username;
    const userCredentials = await getUserCridentials(username);
    const isMatch = await comparePassword(currentPassword, userCredentials.password);
    if (!isMatch) return res.status(401).json({ message: 'Current password does not match' });
    const hashedPassword = await hashPassword(newPassword);
    await changeClientPassword(hashedPassword, userID);
    const user = await getUserById(userID);
    const token = generateJWT(user);
    return res.status(200).json({ message: 'Password changed successfully', token, user });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
}

// ── ACCOUNT DELETION REQUEST ──────────────────────────────────
export async function requestAccountDeletion(req, res) {
  try {
    const userId = req.user?.id;
    const { confirmText } = req.body;

    // Strict confirmation — must type exactly "Confirm Delete"
    if (confirmText !== 'Confirm Delete') {
      return res.status(400).json({ message: 'Confirmation text does not match. Type exactly: Confirm Delete' });
    }

    // Check for active appointments
    const hasAppointments = await hasActiveAppointmentsModel(userId);
    if (hasAppointments) {
      return res.status(400).json({
        message: 'Cannot delete account. You have active or pending appointments.',
        blocker: 'appointment'
      });
    }

    // Check for active/pending transactions
    const hasTransactions = await hasActiveTransactionsModel(userId);
    if (hasTransactions) {
      return res.status(400).json({
        message: 'Cannot delete account. You have active or in-progress transactions.',
        blocker: 'transaction'
      });
    }

    // Proceed with soft deletion
    await softDeleteAccountModel(userId);

    // Notify admins in realtime
    const user = await getUserById(userId);
    emitToAdmins('admin_notification', {
      type: 'account_deletion_request',
      title: 'Account Deleted',
      message: `Account deleted by user: ${user?.username || userId}`,
      timestamp: new Date()
    });

    return res.status(200).json({ message: 'Account deleted successfully. You will be logged out.' });
  } catch (err) {
    console.error('Account deletion error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}