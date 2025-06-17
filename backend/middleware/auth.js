const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
require('dotenv').config();

// In middleware/auth.js - make sure the protect middleware is setting req.user correctly
exports.protect = async (req, res, next) => {
  let token;

  // Get token from header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Check if token exists
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded token:", decoded); // Add debugging

    // Check if user still exists
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ? AND active = 1',
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
    }

    // Add user to request object
    req.user = users[0];
    console.log("User set in request:", { id: req.user.id, name: req.user.name }); // Add debugging
    next();
  } catch (error) {
    console.error("Auth middleware error:", error); // Add debugging
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.type)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.type} is not authorized to access this route`
      });
    }
    next();
  };
};