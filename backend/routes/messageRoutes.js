const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

router.get('/conversations', messageController.getConversations);
router.get('/conversations/:conversationId', messageController.getMessages);
router.post('/conversations/:conversationId', messageController.sendMessage);
router.post('/conversations', messageController.startConversation);
router.get('/unread', messageController.getUnreadCount);

module.exports = router;