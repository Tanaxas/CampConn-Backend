const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/multer');

// Public routes
//router.post('/register', userController.register);
router.post('/login', userController.login);
router.post('/verify-mfa', userController.verifyMfa);
router.post('/forgot-password', userController.forgotPassword);
router.post('/reset-password', userController.resetPassword);
router.post('/register-initiate', userController.registerInitiate);
router.post('/register-complete', userController.registerComplete);
router.post('/resend-otp', userController.resendOtp);

// Protected routes
router.get('/me', protect, userController.getCurrentUser);
router.put('/profile', protect, upload.single('profile_pic'), userController.updateProfile);
router.put('/change-password', protect, userController.changePassword);

// MFA routes
router.post('/setup-mfa', protect, userController.setupMfa);
router.post('/enable-mfa', protect, userController.enableMfa);
router.post('/disable-mfa', protect, userController.disableMfa);

// User profile and reviews
router.get('/:id', protect, userController.getUserById);
router.post('/:userId/reviews', protect, userController.addReview);

// Forgot/Reset Password routes
router.post('/forgot-password', userController.forgotPassword);
router.post('/reset-password', userController.resetPassword);

// otps


module.exports = router;