const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { protect, authorize } = require("../middleware/auth");

// All routes require admin privileges
router.use(protect);
router.use(authorize("admin"));

router.get("/users", adminController.getUsers);
router.put("/users/:id/status", adminController.updateUserStatus);
router.put("/users/:id/make-admin", adminController.makeAdmin);

router.get("/listings/pending", adminController.getPendingListings);
router.put("/listings/:id/approve", adminController.approveListing);
router.put("/listings/:id/reject", adminController.rejectListing);

router.get("/settings", adminController.getSettings);
router.put("/settings", adminController.updateSettings);
router.get("/stats", adminController.getStats);

router.get('/logs', adminController.getLogs);
router.get('/logs/stats', adminController.getLogStats);
router.get('/logs/export', adminController.exportLogs);

module.exports = router;
