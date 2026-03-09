import express from "express";
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  getOrCreateConversationController,
  getConversationMessagesController,
  getActiveConversationsController,
  markMessagesReadController,
  uploadChatFileController,
  unsendMessageController,
  getUnreadCountController,adminCreateConversationController 
} from "../controller/chatController.js";
import { isUserAuthenticated, verifyAccessRole } from "../middleware/auth.js";

const router = express.Router();

const ALLOWED_EXTENSIONS = /\.(jpeg|jpg|png|gif|pdf|doc|docx|txt)$/i;
const ALLOWED_MIMETYPES  = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads/messages/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'msg-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard limit

  fileFilter: (req, file, cb) => {
    const ext     = ALLOWED_EXTENSIONS.test(path.extname(file.originalname));
    const mime    = ALLOWED_MIMETYPES.has(file.mimetype);

    if (ext && mime) return cb(null, true);

    const isVideo = file.mimetype.startsWith('video/');
    const isAudio = file.mimetype.startsWith('audio/');
    let reason = 'Only images (JPEG, PNG, GIF) and documents (PDF, DOC, DOCX, TXT) are allowed.';
    if (isVideo) reason = 'Video files are not supported. Please upload an image or document instead.';
    if (isAudio) reason = 'Audio files are not supported. Please upload an image or document instead.';

    const err = new Error(reason);
    err.code  = 'INVALID_FILE_TYPE';
    cb(err, false);
  },
});

function handleUploadError(err, req, res, next) {
  if (!err) return next();

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'File is too large. Maximum allowed size is 10 MB.' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ message: 'Unexpected file field. Use the "file" field name.' });
  }
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(415).json({ message: err.message });
  }

  return res.status(400).json({ message: err.message || 'File upload failed.' });
}

router.get('/getOrCreateConversation',isUserAuthenticated,verifyAccessRole(['client']),getOrCreateConversationController);
router.get('/getMessages/:conversationId', isUserAuthenticated, getConversationMessagesController);
router.post('/markRead', isUserAuthenticated, markMessagesReadController);
router.get('/getActiveConversations',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),getActiveConversationsController);

router.post(
  '/upload',
  isUserAuthenticated,
  (req, res, next) => {
    chatUpload.single('file')(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
uploadChatFileController
);
router.delete('/unsendMessage/:messageId', isUserAuthenticated, unsendMessageController);
router.get('/getUnreadCount',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),getUnreadCountController);
router.post('/:userId/createConversation',isUserAuthenticated,verifyAccessRole(['admin', 'staff']),adminCreateConversationController);
export default router;