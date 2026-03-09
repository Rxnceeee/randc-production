import express from 'express';
import { loginUser,signupUser,verifyOTPForgotPassword,updateNewPassword,createNewPassword,forgotPassword,verifyOTP ,resendOTP ,requestAccountDeletion} from '../controller/userController.js';
import { getPublicTestimonialsController} from '../controller/clientController.js';
import { getActiveServices} from '../controller/serviceController.js';
import { isUserAuthenticated, verifyAccessRole } from '../middleware/auth.js';
import { sendMagicLinkController,verifyMagicLinkController } from '../controller/magicLinkController.js';

const router = express.Router();

router.get('/services', getActiveServices);
router.get('/getServices', getActiveServices);
router.get('/testimonials/public',getPublicTestimonialsController);

router.post('/login', loginUser);
router.post('/signup', signupUser);
router.post('/verifyOTP', verifyOTP);
router.post('/verifyOTPForgotPassword', verifyOTPForgotPassword);
router.get('/forgotPassword/:email',forgotPassword)
router.post('/updateNewPassword',updateNewPassword);
router.post('/createNewPassword',isUserAuthenticated,verifyAccessRole(['admin', 'staff']), createNewPassword);
router.post('/account/delete', isUserAuthenticated, requestAccountDeletion);
router.post('/resend-otp', resendOTP);


// ── Magic link (passwordless Gmail login) ──
router.post('/magic-link/send',   sendMagicLinkController);
router.get('/magic-link/verify',  verifyMagicLinkController);


export default router;


