const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { pool } = require('../config/db');
const { sendEmail } = require('../utils/email');
require('dotenv').config();

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRATION
  });
};

// Register new user
// STEP 1: Initiate registration with OTP
exports.registerInitiate = async (req, res) => {
  try {
    const { name, email, password, type } = req.body;

    if (!email.endsWith('@hit.ac.zw')) {
      return res.status(400).json({ success: false, message: 'Only HIT email addresses (@hit.ac.zw) are allowed' });
    }

    const [existingUsers] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await pool.execute('INSERT INTO otps (email, otp, type, expires_at) VALUES (?, ?, ?, ?)', [email, otp, 'registration', expiresAt]);

    req.session = req.session || {};
    req.session.pendingRegistration = { name, email, password, type };

    await sendEmail({
      to: email,
      subject: 'Verify Your Email - Campus Connect',
      text: `Your verification code is: ${otp}. It will expire in 10 minutes.`,
      html: `<h1>Email Verification</h1><p>Your verification code is:</p><h2>${otp}</h2><p>Expires in 10 minutes.</p>`
    });

    res.status(200).json({ success: true, message: 'Verification code sent to email', email });
  } catch (error) {
    console.error('Registration initiation error:', error);
    res.status(500).json({ success: false, message: 'Error sending verification code' });
  }
};

// STEP 2: Complete registration after OTP verification
exports.registerComplete = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const [otpRecords] = await pool.execute(
      'SELECT * FROM otps WHERE email = ? AND otp = ? AND type = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [email, otp, 'registration']
    );

    if (otpRecords.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid or expired verification code' });
    }

    const pendingRegistration = req.session?.pendingRegistration;
    if (!pendingRegistration || pendingRegistration.email !== email) {
      return res.status(400).json({ success: false, message: 'Registration session expired or invalid' });
    }

    const { name, password, type } = pendingRegistration;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, type) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, type]
    );

    await pool.execute('DELETE FROM otps WHERE id = ?', [otpRecords[0].id]);
    delete req.session.pendingRegistration;

    let mfaSecret = null;

    const [adminSettings] = await pool.execute('SELECT * FROM admin_settings WHERE id = 1');
    if (adminSettings.length > 0 && adminSettings[0].require_mfa === 1) {
      const secret = speakeasy.generateSecret({ name: `Campus Connect:${email}` });
      mfaSecret = secret.base32;

      await pool.execute('UPDATE users SET mfa_secret = ? WHERE id = ?', [mfaSecret, result.insertId]);
    }

    const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
    const token = generateToken(result.insertId);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: users[0].id,
        name: users[0].name,
        email: users[0].email,
        type: users[0].type,
        profile_pic: users[0].profile_pic,
        mfa_enabled: users[0].mfa_enabled === 1,
        mfa_setup_required: mfaSecret !== null,
        mfa_secret: mfaSecret
      }
    });
  } catch (error) {
    console.error('Registration completion error:', error);
    res.status(500).json({ success: false, message: 'Error completing registration' });
  }
};

// STEP 3: Resend OTP if needed
exports.resendOtp = async (req, res) => {
  try {
    const { email, type = 'registration' } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    await pool.execute('INSERT INTO otps (email, otp, type, expires_at) VALUES (?, ?, ?, ?)', [email, otp, type, expiresAt]);

    await sendEmail({
      to: email,
      subject: type === 'registration' ? 'Verify Your Email - Campus Connect' : 'Password Reset - Campus Connect',
      html: `<h1>${type === 'registration' ? 'Email Verification' : 'Password Reset'}</h1><p>Your verification code is:</p><h2>${otp}</h2><p>This code will expire in 10 minutes.</p>`
    });

    res.status(200).json({ success: true, message: 'Verification code resent to email' });
  } catch (error) {
    console.error('OTP resend error:', error);
    res.status(500).json({ success: false, message: 'Error resending verification code' });
  }
};


// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = users[0];

    // Check if user is active
    if (user.active === 0) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if MFA is enabled
    if (user.mfa_enabled === 1) {
      return res.status(200).json({
        success: true,
        message: 'MFA verification required',
        user: {
          id: user.id,
          require_mfa: true
        }
      });
    }

    // Generate token
    const token = generateToken(user.id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        profile_pic: user.profile_pic,
        mfa_enabled: user.mfa_enabled === 1,
        bio: user.bio
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify MFA code
exports.verifyMfa = async (req, res) => {
  try {
    const { email, code } = req.body;

    // Get user
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1 // Allow 30 seconds before and after
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Generate token
    const token = generateToken(user.id);

    res.status(200).json({
      success: true,
      message: 'MFA verification successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        profile_pic: user.profile_pic,
        mfa_enabled: user.mfa_enabled === 1,
        bio: user.bio
      }
    });
  } catch (error) {
    console.error('MFA verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying MFA',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Setup MFA
exports.setupMfa = async (req, res) => {
  try {
    const userId = req.user.id;

    // Generate a new secret
    const secret = speakeasy.generateSecret({
      name: `Campus Connect:${req.user.email}`
    });

    // Save secret to user record
    await pool.execute(
      'UPDATE users SET mfa_secret = ? WHERE id = ?',
      [secret.base32, userId]
    );

    // Generate QR code
    const otpAuthUrl = secret.otpauth_url;
    const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);

    res.status(200).json({
      success: true,
      message: 'MFA setup initialized',
      secret: secret.base32,
      qrCode: qrCodeDataUrl
    });
  } catch (error) {
    console.error('MFA setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Error setting up MFA',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify and enable MFA
exports.enableMfa = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    // Get user with secret
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );

    const user = users[0];

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Enable MFA
    await pool.execute(
      'UPDATE users SET mfa_enabled = 1 WHERE id = ?',
      [userId]
    );

    res.status(200).json({
      success: true,
      message: 'MFA enabled successfully'
    });
  } catch (error) {
    console.error('MFA enabling error:', error);
    res.status(500).json({
      success: false,
      message: 'Error enabling MFA',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Disable MFA
exports.disableMfa = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    // Get user with secret
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );

    const user = users[0];

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Disable MFA
    await pool.execute(
      'UPDATE users SET mfa_enabled = 0 WHERE id = ?',
      [userId]
    );

    res.status(200).json({
      success: true,
      message: 'MFA disabled successfully'
    });
  } catch (error) {
    console.error('MFA disabling error:', error);
    res.status(500).json({
      success: false,
      message: 'Error disabling MFA',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get current user profile
exports.getCurrentUser = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user details
    const [users] = await pool.execute(
      `SELECT id, name, email, type, profile_pic, bio, phone, location, 
              business_name, business_description, business_hours, 
              active, created_at, updated_at, mfa_enabled
       FROM users WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        profile_pic: user.profile_pic,
        bio: user.bio,
        phone: user.phone,
        location: user.location,
        business_name: user.business_name,
        business_description: user.business_description,
        business_hours: user.business_hours,
        mfa_enabled: user.mfa_enabled === 1,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    console.error('Error getting current user:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting user profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      name, bio, phone, location, 
      business_name, business_description, business_hours 
    } = req.body;

    // Build update query based on provided fields
    let query = 'UPDATE users SET ';
    const values = [];
    
    if (name) {
      query += 'name = ?, ';
      values.push(name);
    }
    
    if (bio !== undefined) {
      query += 'bio = ?, ';
      values.push(bio);
    }
    
    if (phone !== undefined) {
      query += 'phone = ?, ';
      values.push(phone);
    }
    
    if (location !== undefined) {
      query += 'location = ?, ';
      values.push(location);
    }
    
    if (business_name !== undefined) {
      query += 'business_name = ?, ';
      values.push(business_name);
    }
    
    if (business_description !== undefined) {
      query += 'business_description = ?, ';
      values.push(business_description);
    }
    
    if (business_hours !== undefined) {
      query += 'business_hours = ?, ';
      values.push(business_hours);
    }
    
    // Handle profile picture if uploaded
    if (req.file) {
      query += 'profile_pic = ?, ';
      values.push(`/uploads/profiles/${req.file.filename}`);
    }
    
    // Remove trailing comma and space
    query = query.slice(0, -2);
    
    // Add WHERE clause
    query += ' WHERE id = ?';
    values.push(userId);
    
    // Execute the update
    await pool.execute(query, values);
    
    // Get updated user
    const [users] = await pool.execute(
      `SELECT id, name, email, type, profile_pic, bio, phone, location, 
              business_name, business_description, business_hours, 
              active, created_at, updated_at, mfa_enabled
       FROM users WHERE id = ?`,
      [userId]
    );
    
    const user = users[0];
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        profile_pic: user.profile_pic,
        bio: user.bio,
        phone: user.phone,
        location: user.location,
        business_name: user.business_name,
        business_description: user.business_description,
        business_hours: user.business_hours,
        mfa_enabled: user.mfa_enabled === 1,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    // Get current user
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];

    // Check if current password is correct
    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await pool.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get user by ID (for public profile)
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get user details (exclude sensitive info)
    const [users] = await pool.execute(
      `SELECT id, name, email, type, profile_pic, bio, 
              business_name, business_description, business_hours, 
              created_at
       FROM users WHERE id = ? AND active = 1`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = users[0];
    
    // Get user's listings
    const [listings] = await pool.execute(
      `SELECT l.id, l.title, l.category, l.price, l.description, l.created_at, 
              (SELECT image_url FROM listing_images WHERE listing_id = l.id LIMIT 1) AS image
       FROM listings l
       WHERE l.seller_id = ? AND l.status = 'approved'
       ORDER BY l.created_at DESC
       LIMIT 10`,
      [id]
    );

    // Get user's reviews
    const [reviews] = await pool.execute(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              u.id as reviewer_id, u.name as reviewer_name, u.profile_pic as reviewer_pic
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [id]
    );

    // Calculate average rating
    let averageRating = 0;
    if (reviews.length > 0) {
      const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
      averageRating = totalRating / reviews.length;
    }

    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type,
        profile_pic: user.profile_pic,
        bio: user.bio,
        business_name: user.business_name,
        business_description: user.business_description,
        business_hours: user.business_hours,
        created_at: user.created_at,
        ratings: {
          average: averageRating,
          count: reviews.length
        },
        listings,
        reviews
      }
    });
  } catch (error) {
    console.error('Error getting user by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting user profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add a review for a user
exports.addReview = async (req, res) => {
  try {
    const { userId } = req.params;
    const { rating, comment } = req.body;
    const reviewerId = req.user.id;

    // Check if user exists
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ? AND active = 1',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if reviewer is not reviewing themselves
    if (parseInt(userId) === reviewerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot review yourself'
      });
    }

    // Check if user has already reviewed this user
    const [existingReviews] = await pool.execute(
      'SELECT * FROM reviews WHERE user_id = ? AND reviewer_id = ?',
      [userId, reviewerId]
    );

    if (existingReviews.length > 0) {
      // Update existing review
      await pool.execute(
        'UPDATE reviews SET rating = ?, comment = ? WHERE user_id = ? AND reviewer_id = ?',
        [rating, comment, userId, reviewerId]
      );

      return res.status(200).json({
        success: true,
        message: 'Review updated successfully'
      });
    }

    // Create new review
    await pool.execute(
      'INSERT INTO reviews (user_id, reviewer_id, rating, comment) VALUES (?, ?, ?, ?)',
      [userId, reviewerId, rating, comment]
    );

    res.status(201).json({
      success: true,
      message: 'Review added successfully'
    });
  } catch (error) {
    console.error('Review add error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding review',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Request password reset
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND active = 1',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate OTP code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiration (10 minutes from now)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    // Save OTP to database
    await pool.execute(
      'INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)',
      [email, otp, expiresAt]
    );

    // Send email
    await sendEmail({
      to: email,
      subject: 'Password Reset OTP',
      text: `Your OTP for password reset is: ${otp}. It will expire in 10 minutes.`,
      html: `
        <h1>Password Reset</h1>
        <p>Your OTP for password reset is:</p>
        <h2 style="text-align: center; font-size: 32px; letter-spacing: 5px;">${otp}</h2>
        <p>This code will expire in 10 minutes.</p>
        <p>If you did not request this reset, please ignore this email.</p>
      `
    });

    res.status(200).json({
      success: true,
      message: 'OTP sent to email'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending password reset OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Reset password with OTP
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate OTP
    const [otps] = await pool.execute(
      'SELECT * FROM otps WHERE email = ? AND otp = ? AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [email, otp]
    );

    if (otps.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await pool.execute(
      'UPDATE users SET password = ? WHERE email = ?',
      [hashedPassword, email]
    );

    // Delete used OTP
    await pool.execute(
      'DELETE FROM otps WHERE id = ?',
      [otps[0].id]
    );

    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// for logging
const Logger = require('../utils/logger');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      // Log failed login attempt
      await Logger.logAuth(req, 'login', 'failure', null, 'Invalid credentials');
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = users[0];

    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Log failed login attempt
      await Logger.logAuth(req, 'login', 'failure', null, 'Invalid credentials');
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken(user.id);

    // Log successful login
    await Logger.logAuth(req, 'login', 'success', { userId: user.id });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: user.type
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    
    // Log error
    await Logger.logAuth(req, 'login', 'failure', null, error.message);
    
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
