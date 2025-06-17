const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');

// Get all users (admin only)
exports.getUsers = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, name, email, type, profile_pic, bio, phone, location, 
              business_name, active, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.status(200).json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update user status (active/inactive)
exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    // Check if user exists
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent deactivating self
    if (parseInt(id) === req.user.id && active === 0) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    // Update user status
    await pool.execute(
      'UPDATE users SET active = ? WHERE id = ?',
      [active, id]
    );

    res.status(200).json({
      success: true,
      message: `User ${active ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Make user an admin
exports.makeAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user type
    await pool.execute(
      'UPDATE users SET type = "admin" WHERE id = ?',
      [id]
    );

    res.status(200).json({
      success: true,
      message: 'User promoted to admin successfully'
    });
  } catch (error) {
    console.error('Make admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error promoting user to admin',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get pending listings
exports.getPendingListings = async (req, res) => {
  try {
    const [listings] = await pool.execute(
      `SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic
       FROM listings l
       JOIN users u ON l.seller_id = u.id
       WHERE l.status = 'pending'
       ORDER BY l.created_at ASC`
    );

    // Get images for each listing
    const listingsWithImages = await Promise.all(
      listings.map(async (listing) => {
        const [images] = await pool.execute(
          'SELECT image_url FROM listing_images WHERE listing_id = ?',
          [listing.id]
        );

        return {
          ...listing,
          images: images.map(img => img.image_url)
        };
      })
    );

    res.status(200).json({
      success: true,
      count: listingsWithImages.length,
      listings: listingsWithImages
    });
  } catch (error) {
    console.error('Get pending listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Approve a listing
exports.approveListing = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if listing exists
    const [listings] = await pool.execute(
      'SELECT * FROM listings WHERE id = ?',
      [id]
    );

    if (listings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Update listing status
    await pool.execute(
      'UPDATE listings SET status = "approved" WHERE id = ?',
      [id]
    );

    res.status(200).json({
      success: true,
      message: 'Listing approved successfully'
    });
  } catch (error) {
    console.error('Approve listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Reject a listing
exports.rejectListing = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Check if listing exists
    const [listings] = await pool.execute(
      'SELECT * FROM listings WHERE id = ?',
      [id]
    );

    if (listings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Update listing status
    await pool.execute(
      'UPDATE listings SET status = "rejected" WHERE id = ?',
      [id]
    );

    // TODO: Notify user about rejection with reason

    res.status(200).json({
      success: true,
      message: 'Listing rejected successfully'
    });
  } catch (error) {
    console.error('Reject listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get admin settings
exports.getSettings = async (req, res) => {
  try {
    // Check if settings exist
    const [settings] = await pool.execute(
      'SELECT * FROM admin_settings WHERE id = 1'
    );

    if (settings.length === 0) {
      // Create default settings
      await pool.execute(
        `INSERT INTO admin_settings 
         (id, require_listing_approval, require_mfa, allowed_categories) 
         VALUES (1, 1, 0, 'Textbooks,Electronics,Services,Accommodation,Other')`
      );

      const [newSettings] = await pool.execute(
        'SELECT * FROM admin_settings WHERE id = 1'
      );

      return res.status(200).json({
        success: true,
        settings: newSettings[0]
      });
    }

    res.status(200).json({
      success: true,
      settings: settings[0]
    });
  } catch (error) {
    console.error('Get admin settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching admin settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update admin settings
exports.updateSettings = async (req, res) => {
  try {
    const { require_listing_approval, require_mfa, allowed_categories } = req.body;

    // Check if settings exist
    const [settings] = await pool.execute(
      'SELECT * FROM admin_settings WHERE id = 1'
    );

    if (settings.length === 0) {
      // Create settings
      await pool.execute(
        `INSERT INTO admin_settings 
         (id, require_listing_approval, require_mfa, allowed_categories) 
         VALUES (1, ?, ?, ?)`,
        [
          require_listing_approval ? 1 : 0,
          require_mfa ? 1 : 0,
          allowed_categories
        ]
      );
    } else {
      // Update settings
      await pool.execute(
        `UPDATE admin_settings 
         SET require_listing_approval = ?, 
             require_mfa = ?, 
             allowed_categories = ? 
         WHERE id = 1`,
        [
          require_listing_approval ? 1 : 0,
          require_mfa ? 1 : 0,
          allowed_categories
        ]
      );
    }

    // Get updated settings
    const [updatedSettings] = await pool.execute(
      'SELECT * FROM admin_settings WHERE id = 1'
    );

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      settings: updatedSettings[0]
    });
  } catch (error) {
    console.error('Update admin settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating admin settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get site statistics
exports.getStats = async (req, res) => {
  try {
    // Get user count
    const [userCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM users'
    );

    // Get active listings count
    const [listingCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM listings WHERE status = "approved"'
    );

    // Get pending listings count
    const [pendingCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM listings WHERE status = "pending"'
    );

    // Get category distribution
    const [categories] = await pool.execute(
      `SELECT category, COUNT(*) as count 
       FROM listings 
       WHERE status = "approved" 
       GROUP BY category`
    );

    // Get recent listings
    const [recentListings] = await pool.execute(
      `SELECT l.id, l.title, l.price, l.category, l.created_at, u.name as seller_name
       FROM listings l
       JOIN users u ON l.seller_id = u.id
       WHERE l.status = "approved"
       ORDER BY l.created_at DESC
       LIMIT 5`
    );

    // Get new users
    const [newUsers] = await pool.execute(
      `SELECT id, name, email, type, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 5`
    );

    res.status(200).json({
      success: true,
      stats: {
        users: userCount[0].count,
        listings: listingCount[0].count,
        pendingListings: pendingCount[0].count,
        categories,
        recentListings,
        newUsers
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get logs with pagination and filtering
exports.getLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      userId,
      eventType,
      resourceType,
      action,
      status
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    // Build query conditions
    let conditions = [];
    let params = [];
    
    if (startDate) {
      conditions.push('timestamp >= ?');
      params.push(new Date(startDate));
    }
    
    if (endDate) {
      conditions.push('timestamp <= ?');
      params.push(new Date(endDate));
    }
    
    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    
    if (eventType) {
      conditions.push('event_type = ?');
      params.push(eventType);
    }
    
    if (resourceType) {
      conditions.push('resource_type = ?');
      params.push(resourceType);
    }
    
    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }
    
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';
    
    // Get logs with pagination
    const [logs] = await pool.execute(
      `SELECT * FROM activity_logs
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    
    // Get total count for pagination
    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM activity_logs ${whereClause}`,
      params
    );
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);
    
    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      totalPages,
      currentPage: parseInt(page),
      logs
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching logs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get log statistics
exports.getLogStats = async (req, res) => {
  try {
    // Get event type counts
    const [eventTypeCounts] = await pool.execute(
      `SELECT event_type, COUNT(*) as count
       FROM activity_logs
       GROUP BY event_type`
    );
    
    // Get status counts
    const [statusCounts] = await pool.execute(
      `SELECT status, COUNT(*) as count
       FROM activity_logs
       GROUP BY status`
    );
    
    // Get logs per day for the last 30 days
    const [dailyCounts] = await pool.execute(
      `SELECT DATE(timestamp) as date, COUNT(*) as count
       FROM activity_logs
       WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(timestamp)
       ORDER BY date`
    );
    
    // Get top users by activity
    const [topUsers] = await pool.execute(
      `SELECT user_id, user_email, COUNT(*) as count
       FROM activity_logs
       WHERE user_id IS NOT NULL
       GROUP BY user_id
       ORDER BY count DESC
       LIMIT 10`
    );
    
    res.status(200).json({
      success: true,
      stats: {
        eventTypeCounts,
        statusCounts,
        dailyCounts,
        topUsers
      }
    });
  } catch (error) {
    console.error('Get log stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching log statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Export logs (CSV format)
exports.exportLogs = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      eventType,
      resourceType,
      status
    } = req.query;
    
    // Build query conditions (similar to getLogs)
    let conditions = [];
    let params = [];
    
    // Add filter conditions...
    
    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';
    
    // Get logs for export
    const [logs] = await pool.execute(
      `SELECT id, timestamp, user_id, user_email, ip_address, 
              event_type, resource_type, resource_id, action, 
              status, error_message, created_at
       FROM activity_logs
       ${whereClause}
       ORDER BY timestamp DESC`,
      params
    );
    
    // Convert to CSV
    const fields = [
      'id', 'timestamp', 'user_id', 'user_email', 'ip_address',
      'event_type', 'resource_type', 'resource_id', 'action',
      'status', 'error_message', 'created_at'
    ];
    
    const csv = [
      fields.join(','), // Header row
      ...logs.map(log => {
        return fields.map(field => {
          const value = log[field];
          return value === null ? '' : `"${String(value).replace(/"/g, '""')}"`;
        }).join(',');
      })
    ].join('\n');
    
    // Set response headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=logs_export_${new Date().toISOString().split('T')[0]}.csv`);
    
    res.status(200).send(csv);
  } catch (error) {
    console.error('Export logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting logs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};