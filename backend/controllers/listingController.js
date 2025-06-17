const { pool } = require('../config/db');
const fs = require('fs');
const path = require('path');

// Create a new listing
exports.createListing = async (req, res) => {
  try {
    const { title, category, price, description, contact } = req.body;
    const sellerId = req.user.id;

    // Check if admin approval is required
    const [settings] = await pool.execute('SELECT * FROM admin_settings WHERE id = 1');
    const requireApproval = settings.length > 0 ? settings[0].require_listing_approval : 1;
    const status = requireApproval ? 'pending' : 'approved';

    // Insert the listing
    const [result] = await pool.execute(
      'INSERT INTO listings (title, category, price, description, contact, seller_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, category, price, description, contact, sellerId, status]
    );

    const listingId = result.insertId;

    // Process uploaded images if any
    if (req.files && req.files.length > 0) {
      const imageInsertPromises = req.files.map(file => {
        const imageUrl = `/uploads/listings/${file.filename}`;
        return pool.execute(
          'INSERT INTO listing_images (listing_id, image_url) VALUES (?, ?)',
          [listingId, imageUrl]
        );
      });

      await Promise.all(imageInsertPromises);
    }

    // Get the newly created listing with images
    const [listings] = await pool.execute(
      `SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic 
       FROM listings l 
       JOIN users u ON l.seller_id = u.id 
       WHERE l.id = ?`,
      [listingId]
    );

    const [images] = await pool.execute(
      'SELECT * FROM listing_images WHERE listing_id = ?',
      [listingId]
    );

    res.status(201).json({
      success: true,
      message: status === 'pending' ? 'Listing submitted for approval' : 'Listing created successfully',
      listing: {
        ...listings[0],
        images: images.map(img => img.image_url)
      }
    });
  } catch (error) {
    console.error('Listing creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all approved listings
exports.getListings = async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = `
      SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic
      FROM listings l
      JOIN users u ON l.seller_id = u.id
      WHERE l.status = 'approved'
    `;
    const params = [];

    if (category) {
      query += ' AND l.category = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (l.title LIKE ? OR l.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY l.created_at DESC';

    const [listings] = await pool.execute(query, params);

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
    console.error('Get listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get a single listing by ID
exports.getListing = async (req, res) => {
  try {
    const { id } = req.params;

    const [listings] = await pool.execute(
      `SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic
       FROM listings l
       JOIN users u ON l.seller_id = u.id
       WHERE l.id = ? AND (l.status = 'approved' OR l.seller_id = ?)`,
      [id, req.user.id]
    );

    if (listings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    const listing = listings[0];

    // Get images
    const [images] = await pool.execute(
      'SELECT image_url FROM listing_images WHERE listing_id = ?',
      [id]
    );

    res.status(200).json({
      success: true,
      listing: {
        ...listing,
        images: images.map(img => img.image_url)
      }
    });
  } catch (error) {
    console.error('Get listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update a listing
exports.updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, price, description, contact } = req.body;
    const userId = req.user.id;

    // Check if listing exists and belongs to the user
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

    const listing = listings[0];

    if (listing.seller_id !== userId && req.user.type !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this listing'
      });
    }

    // Check if admin approval is required for updates
    const [settings] = await pool.execute('SELECT * FROM admin_settings WHERE id = 1');
    const requireApproval = settings.length > 0 ? settings[0].require_listing_approval : 1;
    
    // If significant changes and requires approval, set status to pending
    let status = listing.status;
    if (requireApproval && (
        title !== listing.title || 
        category !== listing.category || 
        Math.abs(parseFloat(price) - parseFloat(listing.price)) > 0.01 ||
        description !== listing.description
      )) {
      status = 'pending';
    }

    // Update the listing
    await pool.execute(
      'UPDATE listings SET title = ?, category = ?, price = ?, description = ?, contact = ?, status = ? WHERE id = ?',
      [title, category, price, description, contact, status, id]
    );

    // Process uploaded images if any
    if (req.files && req.files.length > 0) {
      // Delete old images if replace_images flag is set
      if (req.body.replace_images === 'true') {
        // Get existing images
        const [existingImages] = await pool.execute(
          'SELECT image_url FROM listing_images WHERE listing_id = ?',
          [id]
        );

        // Delete image files
        existingImages.forEach(img => {
          const filePath = path.join(__dirname, '..', img.image_url);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        });

        // Delete from database
        await pool.execute(
          'DELETE FROM listing_images WHERE listing_id = ?',
          [id]
        );
      }

      // Add new images
      const imageInsertPromises = req.files.map(file => {
        const imageUrl = `/uploads/listings/${file.filename}`;
        return pool.execute(
          'INSERT INTO listing_images (listing_id, image_url) VALUES (?, ?)',
          [id, imageUrl]
        );
      });

      await Promise.all(imageInsertPromises);
    }

    // Get the updated listing with images
    const [updatedListings] = await pool.execute(
      `SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic
       FROM listings l
       JOIN users u ON l.seller_id = u.id
       WHERE l.id = ?`,
      [id]
    );

    const [images] = await pool.execute(
      'SELECT image_url FROM listing_images WHERE listing_id = ?',
      [id]
    );

    res.status(200).json({
      success: true,
      message: status === 'pending' ? 'Listing updated and submitted for approval' : 'Listing updated successfully',
      listing: {
        ...updatedListings[0],
        images: images.map(img => img.image_url)
      }
    });
  } catch (error) {
    console.error('Update listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete a listing
exports.deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if listing exists and belongs to the user
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

    const listing = listings[0];

    if (listing.seller_id !== userId && req.user.type !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this listing'
      });
    }

    // Get images to delete files
    const [images] = await pool.execute(
      'SELECT image_url FROM listing_images WHERE listing_id = ?',
      [id]
    );

    // Delete the listing (cascade will remove images from database)
    await pool.execute(
      'DELETE FROM listings WHERE id = ?',
      [id]
    );

    // Delete image files
    images.forEach(img => {
      const filePath = path.join(__dirname, '..', img.image_url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    res.status(200).json({
      success: true,
      message: 'Listing deleted successfully'
    });
  } catch (error) {
    console.error('Delete listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get listings by current user
exports.getMyListings = async (req, res) => {
  try {
    const userId = req.user.id;

    const [listings] = await pool.execute(
      `SELECT l.*
       FROM listings l
       WHERE l.seller_id = ?
       ORDER BY l.created_at DESC`,
      [userId]
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
    console.error('Get my listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get listings by seller ID
exports.getListingsBySeller = async (req, res) => {
  try {
    const { sellerId } = req.params;

    const [listings] = await pool.execute(
      `SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic
       FROM listings l
       JOIN users u ON l.seller_id = u.id
       WHERE l.seller_id = ? AND l.status = 'approved'
       ORDER BY l.created_at DESC`,
      [sellerId]
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
    console.error('Get seller listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// Get reviews for a listing
exports.getListingReviews = async (req, res) => {
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

    // Get reviews
    const [reviews] = await pool.execute(
      `SELECT lr.*, u.name as reviewer_name, u.profile_pic as reviewer_pic
       FROM listing_reviews lr
       JOIN users u ON lr.reviewer_id = u.id
       WHERE lr.listing_id = ?
       ORDER BY lr.created_at DESC`,
      [id]
    );

    // Calculate average rating
    let averageRating = 0;
    if (reviews.length > 0) {
      const sum = reviews.reduce((total, review) => total + review.rating, 0);
      averageRating = sum / reviews.length;
    }

    res.status(200).json({
      success: true,
      count: reviews.length,
      averageRating,
      reviews
    });
  } catch (error) {
    console.error('Get listing reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add a review to a listing
exports.addListingReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const reviewerId = req.user.id;

    // Validate rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    // Check if listing exists and is approved
    const [listings] = await pool.execute(
      'SELECT * FROM listings WHERE id = ? AND status = "approved"',
      [id]
    );

    if (listings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found or not approved'
      });
    }

    // Prevent self-reviews
    if (listings[0].seller_id === reviewerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot review your own listing'
      });
    }

    // Check if user already reviewed this listing
    const [existingReviews] = await pool.execute(
      'SELECT * FROM listing_reviews WHERE listing_id = ? AND reviewer_id = ?',
      [id, reviewerId]
    );

    if (existingReviews.length > 0) {
      // Update existing review
      await pool.execute(
        'UPDATE listing_reviews SET rating = ?, comment = ? WHERE listing_id = ? AND reviewer_id = ?',
        [rating, comment, id, reviewerId]
      );

      res.status(200).json({
        success: true,
        message: 'Review updated successfully'
      });
    } else {
      // Add new review
      await pool.execute(
        'INSERT INTO listing_reviews (listing_id, reviewer_id, rating, comment) VALUES (?, ?, ?, ?)',
        [id, reviewerId, rating, comment]
      );

      res.status(201).json({
        success: true,
        message: 'Review added successfully'
      });
    }
  } catch (error) {
    console.error('Add listing review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding review',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update getListing function to include average rating
exports.getListing = async (req, res) => {
  try {
    const { id } = req.params;

    const [listings] = await pool.execute(
      `SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic
       FROM listings l
       JOIN users u ON l.seller_id = u.id
       WHERE l.id = ? AND (l.status = 'approved' OR l.seller_id = ?)`,
      [id, req.user.id]
    );

    if (listings.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    const listing = listings[0];

    // Get images
    const [images] = await pool.execute(
      'SELECT image_url FROM listing_images WHERE listing_id = ?',
      [id]
    );

    // Get rating summary
    const [ratingResult] = await pool.execute(
      `SELECT AVG(rating) as averageRating, COUNT(*) as reviewCount
       FROM listing_reviews
       WHERE listing_id = ?`,
      [id]
    );

    const ratings = {
      average: ratingResult[0].averageRating || 0,
      count: ratingResult[0].reviewCount || 0
    };

    res.status(200).json({
      success: true,
      listing: {
        ...listing,
        images: images.map(img => img.image_url),
        ratings
      }
    });
  } catch (error) {
    console.error('Get listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update getListings to include ratings
exports.getListings = async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = `
      SELECT l.*, u.name as seller_name, u.email as seller_email, u.profile_pic as seller_profile_pic
      FROM listings l
      JOIN users u ON l.seller_id = u.id
      WHERE l.status = 'approved'
    `;
    const params = [];

    if (category) {
      query += ' AND l.category = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (l.title LIKE ? OR l.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY l.created_at DESC';

    const [listings] = await pool.execute(query, params);

    // Get images and ratings for each listing
    const listingsWithDetails = await Promise.all(
      listings.map(async (listing) => {
        const [images] = await pool.execute(
          'SELECT image_url FROM listing_images WHERE listing_id = ?',
          [listing.id]
        );

        const [ratingResult] = await pool.execute(
          `SELECT AVG(rating) as averageRating, COUNT(*) as reviewCount
           FROM listing_reviews
           WHERE listing_id = ?`,
          [listing.id]
        );

        return {
          ...listing,
          images: images.map(img => img.image_url),
          ratings: {
            average: ratingResult[0].averageRating || 0,
            count: ratingResult[0].reviewCount || 0
          }
        };
      })
    );

    res.status(200).json({
      success: true,
      count: listingsWithDetails.length,
      listings: listingsWithDetails
    });
  } catch (error) {
    console.error('Get listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};