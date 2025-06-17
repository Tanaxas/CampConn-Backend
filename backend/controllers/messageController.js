const { pool } = require('../config/db');

// Get conversations for current user
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    const [conversations] = await pool.execute(
      `SELECT c.id, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m 
               WHERE m.conversation_id = c.id 
               AND m.sender_id != ? 
               AND m.read_status = 0) as unread_count
       FROM conversations c
       JOIN conversation_participants cp ON c.id = cp.conversation_id
       WHERE cp.user_id = ?
       ORDER BY c.updated_at DESC`,
      [userId, userId]
    );

    // Get conversation details
    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conversation) => {
        // Get other participants
        const [participants] = await pool.execute(
          `SELECT u.id, u.name, u.email, u.profile_pic
           FROM conversation_participants cp
           JOIN users u ON cp.user_id = u.id
           WHERE cp.conversation_id = ? AND cp.user_id != ?`,
          [conversation.id, userId]
        );

        // Get last message
        const [messages] = await pool.execute(
          `SELECT m.*, u.name as sender_name
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.conversation_id = ?
           ORDER BY m.created_at DESC
           LIMIT 1`,
          [conversation.id]
        );

        return {
          id: conversation.id,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
          participants: participants,
          last_message: messages.length > 0 ? messages[0] : null,
          unread_count: conversation.unread_count
        };
      })
    );

    res.status(200).json({
      success: true,
      count: conversationsWithDetails.length,
      conversations: conversationsWithDetails
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching conversations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get messages for a conversation
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // Check if user is a participant in the conversation
    const [participants] = await pool.execute(
      'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );

    if (participants.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this conversation'
      });
    }

    // Get messages
    const [messages] = await pool.execute(
      `SELECT m.*, u.name as sender_name, u.profile_pic as sender_pic
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    // Mark messages as read
    await pool.execute(
      `UPDATE messages 
       SET read_status = 1 
       WHERE conversation_id = ? AND sender_id != ?`,
      [conversationId, userId]
    );

    res.status(200).json({
      success: true,
      count: messages.length,
      messages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send a message
exports.sendMessage = async (req, res) => {
  try {
    //const { conversationId, text } = req.body;
    const { text } = req.body;
    const { conversationId } = req.params;  // If using route params
    const senderId = req.user.id;

    // Assign null to conversationId if it is undefined or falsy
    const finalconversationId = conversationId || null;

    console.log('Received message data:', { conversationId, text, senderId });

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: 'Conversation ID is required. Use startConversation if you want to create a new conversation.'
      });
    }

    // Check if conversation exists
    const [conversations] = await pool.execute(
      'SELECT * FROM conversations WHERE id = ?',
      [conversationId]
    );

    if (conversations.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Check if user is a participant
    const [participants] = await pool.execute(
      'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, senderId]
    );

    if (participants.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to send messages in this conversation'
      });
    }



    // Insert message
    if (!conversationId || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Conversation ID and message text are required.'
      });
    }
    
    
    const [result] = await pool.execute(
      'INSERT INTO messages (conversation_id, sender_id, text) VALUES (?, ?, ?)',
      [conversationId, senderId, text]
    );

    // Update conversation timestamp
    await pool.execute(
      'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
      [conversationId]
    );

    // Get the new message with sender info
    const [messages] = await pool.execute(
      `SELECT m.*, u.name as sender_name, u.profile_pic as sender_pic
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: messages[0]
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Start a new conversation

exports.startConversation = async (req, res) => {
  try {
    const { recipientId, initialMessage } = req.body;
    
    // Add debugging to see what's happening
    console.log("Start Conversation Request:", {
      body: req.body,
      user: req.user,
      recipientId: req.body.recipientId,
      initialMessage: req.body.initialMessage
    });
    
    // Make sure user is authenticated and has an ID
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated or missing ID'
      });
    }
    
    const senderId = req.user.id;

    // Check if recipient exists
    const [recipients] = await pool.execute(
      'SELECT * FROM users WHERE id = ? AND active = 1',
      [recipientId]
    );

    if (recipients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    // Check if conversation already exists between these users
    const [existingConversations] = await pool.execute(
      `SELECT c.id
       FROM conversations c
       JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
       JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
       WHERE cp1.user_id = ? AND cp2.user_id = ?`,
      [senderId, recipientId]
    );

    let conversationId;

    if (existingConversations.length > 0) {
      // Use existing conversation
      conversationId = existingConversations[0].id;
      console.log(`Using existing conversation: ${conversationId}`);
    } else {
      // Create new conversation
      const [result] = await pool.execute(
        'INSERT INTO conversations () VALUES ()',
        []
      );
      
      conversationId = result.insertId;
      console.log(`Created new conversation: ${conversationId}`);

      // Add participants
      await pool.execute(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
        [conversationId, senderId]
      );
      
      await pool.execute(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
        [conversationId, recipientId]
      );
    }

    // Send initial message if provided
    if (initialMessage) {
      await pool.execute(
        'INSERT INTO messages (conversation_id, sender_id, text) VALUES (?, ?, ?)',
        [conversationId, senderId, initialMessage]
      );

      // Update conversation timestamp
      await pool.execute(
        'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
        [conversationId]
      );
    }

    // Get conversation details
    const [conversations] = await pool.execute(
      `SELECT c.id, c.created_at, c.updated_at
       FROM conversations c
       WHERE c.id = ?`,
      [conversationId]
    );

    // Get participants
    const [participants] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.profile_pic
       FROM conversation_participants cp
       JOIN users u ON cp.user_id = u.id
       WHERE cp.conversation_id = ?`,
      [conversationId]
    );

    // Get messages
    const [messages] = await pool.execute(
      `SELECT m.*, u.name as sender_name, u.profile_pic as sender_pic
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    res.status(201).json({
      success: true,
      message: 'Conversation started successfully',
      conversation: {
        ...conversations[0],
        participants,
        messages
      }
    });
  } catch (error) {
    console.error('Start conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting conversation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get unread message count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [result] = await pool.execute(
      `SELECT COUNT(*) as count
       FROM messages m
       JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
       WHERE cp.user_id = ? AND m.sender_id != ? AND m.read_status = 0`,
      [userId, userId]
    );

    res.status(200).json({
      success: true,
      count: result[0].count
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unread message count',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};