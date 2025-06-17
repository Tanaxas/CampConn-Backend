const { pool } = require('../config/db');
const crypto = require('crypto');

// In the Logger class

class Logger {
  /**
   * Log an activity event
   * @param {Object} options - Logging options
   * @param {number|null} options.userId - User ID (null for system events)
   * @param {string|null} options.userEmail - User email
   * @param {string} options.ipAddress - IP address
   * @param {string} options.userAgent - User agent string
   * @param {string} options.eventType - Type of event (auth, data, admin, system)
   * @param {string} options.resourceType - Type of resource (user, listing, message, etc.)
   * @param {string|null} options.resourceId - ID of the resource
   * @param {string} options.action - Action performed (create, read, update, delete, etc.)
   * @param {Object|null} options.details - Additional details (stored as JSON)
   * @param {string} options.status - Status of action (success, failure, warning, info)
   * @param {string|null} options.errorMessage - Error message if applicable
   * @returns {Promise<void>}
   */
  static async log({
    userId = null,
    userEmail = null,
    ipAddress = '0.0.0.0',
    userAgent = null,
    eventType,
    resourceType,
    resourceId = null,
    action,
    details = null,
    status = 'success',
    errorMessage = null
  }) {
    try {
      // Sanitize inputs
      const sanitizedDetails = details ? JSON.stringify(details) : null;
      
      // Insert log entry
      await pool.execute(
        `INSERT INTO activity_logs 
        (user_id, user_email, ip_address, user_agent, event_type, 
         resource_type, resource_id, action, details, status, error_message) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId, 
          userEmail, 
          ipAddress, 
          userAgent, 
          eventType, 
          resourceType, 
          resourceId, 
          action, 
          sanitizedDetails, 
          status, 
          errorMessage
        ]
      );
    } catch (error) {
      // Use a fallback logging mechanism if database logging fails
      console.error('Logging error:', error);
      console.error('Failed to log:', {
        userId, userEmail, ipAddress, eventType, 
        resourceType, resourceId, action, status
      });
    }
  }

  /**
   * Helper method for auth events
   */
  static async logAuth(req, action, status, details = null, errorMessage = null) {
    const userId = req.user?.id || null;
    const userEmail = req.user?.email || req.body?.email || null;
    
    return this.log({
      userId,
      userEmail,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      eventType: 'auth',
      resourceType: 'user',
      resourceId: userId,
      action,
      details,
      status,
      errorMessage
    });
  }

  /**
   * Helper method for data manipulation events
   */
  static async logData(req, resourceType, resourceId, action, status, details = null, errorMessage = null) {
    return this.log({
      userId: req.user?.id,
      userEmail: req.user?.email,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      eventType: 'data',
      resourceType,
      resourceId,
      action,
      details,
      status,
      errorMessage
    });
  }

  /**
   * Helper method for admin actions
   */
  static async logAdmin(req, resourceType, resourceId, action, status, details = null, errorMessage = null) {
    return this.log({
      userId: req.user?.id,
      userEmail: req.user?.email,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      eventType: 'admin',
      resourceType,
      resourceId,
      action,
      details,
      status,
      errorMessage
    });
  }

  /**
   * Helper method for system events
   */
  static async logSystem(action, status, details = null, errorMessage = null) {
    return this.log({
      userId: null,
      userEmail: null,
      ipAddress: '0.0.0.0',
      userAgent: 'System',
      eventType: 'system',
      resourceType: 'system',
      resourceId: null,
      action,
      details,
      status,
      errorMessage
    });
  }
  static async encryptDetails(details) {
    if (!details) return { encryptedDetails: null, iv: null };
    
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.LOG_ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(JSON.stringify(details), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      encryptedDetails: encrypted,
      iv: iv.toString('hex')
    };
  }
  
  static async decryptDetails(encryptedDetails, iv) {
    if (!encryptedDetails || !iv) return null;
    
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.LOG_ENCRYPTION_KEY, 'hex');
    const ivBuffer = Buffer.from(iv, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, ivBuffer);
    let decrypted = decipher.update(encryptedDetails, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }
}

module.exports = Logger;