const Logger = require('../utils/logger');

exports.logRequest = async (req, res, next) => {
  // Store original end method
  const originalEnd = res.end;
  
  // Get request start time
  req.startTime = Date.now();
  
  // Override end method
  res.end = function(chunk, encoding) {
    // Calculate response time
    const responseTime = Date.now() - req.startTime;
    
    // Get status code from response
    const statusCode = res.statusCode;
    const isSuccess = statusCode >= 200 && statusCode < 400;
    
    // Log the request
    Logger.log({
      userId: req.user?.id || null,
      userEmail: req.user?.email || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      eventType: 'api',
      resourceType: req.originalUrl.split('/')[2] || 'unknown', // Extract resource from URL
      resourceId: null,
      action: req.method,
      details: {
        url: req.originalUrl,
        method: req.method,
        params: req.params,
        query: req.query,
        body: sanitizeRequestBody(req.body),
        statusCode,
        responseTime
      },
      status: isSuccess ? 'success' : 'failure',
      errorMessage: !isSuccess ? res.statusMessage : null
    }).catch(err => console.error('Error logging request:', err));
    
    // Call original end method
    return originalEnd.apply(res, arguments);
  };
  
  next();
};

// Sanitize request body to remove sensitive data
function sanitizeRequestBody(body) {
  if (!body) return null;
  
  const sanitized = { ...body };
  
  // Remove sensitive fields
  const sensitiveFields = ['password', 'confirmPassword', 'currentPassword', 'newPassword', 'otp'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) sanitized[field] = '[REDACTED]';
  });
  
  return sanitized;
}