const express = require('express');
const router = express.Router();
const listingController = require('../controllers/listingController');
const { protect, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/multer');

// Public routes
router.get('/', listingController.getListings);
router.get('/:id', protect, listingController.getListing);
router.get('/seller/:sellerId', listingController.getListingsBySeller);

// Protected routes
router.post('/', protect, upload.array('listing_images', 5), listingController.createListing);
router.put('/:id', protect, upload.array('listing_images', 5), listingController.updateListing);
router.delete('/:id', protect, listingController.deleteListing);
router.get('/user/me', protect, listingController.getMyListings);

// Reviews
router.get('/:id/reviews', listingController.getListingReviews);
router.post('/:id/reviews', protect, listingController.addListingReview);

module.exports = router;