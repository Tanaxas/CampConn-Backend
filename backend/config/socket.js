const { pool } = require('./config/db');

module.exports = (io) => {
  // Store online users
  const onlineUsers = new Map();

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // User connects with authentication
    socket.on('user_connect', async (userId) => {
      onlineUsers.set(userId, socket.id);
      console.log(`User ${userId} connected with socket ${socket.id}`);
      
      // Update the online status for all clients
      io.emit('user_status', { userId, status: 'online' });
    });

    // User sends a message
    socket.on('send_message', async (messageData) => {
      try {
        const { conversationId, senderId, receiverId, text } = messageData;

        // Add a guard against undefined conversationId
        if (!conversationId) {
          const error = { message: 'Conversation ID is required' };
          console.error('Error:', error.message);
          socket.emit('error', error);
          if (callback) callback(error);
          return;
        }
        
        // Insert message into database
        const [result] = await pool.execute(
          'INSERT INTO messages (conversation_id, sender_id, text) VALUES (?, ?, ?)',
          [conversationId, senderId, text]
        );
        
        // Update conversation timestamp
        await pool.execute(
          'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
          [conversationId]
        );
        
        // Get the newly created message with additional info
        const [messages] = await pool.execute(
          `SELECT m.*, u.name as sender_name, u.profile_pic as sender_pic 
           FROM messages m 
           JOIN users u ON m.sender_id = u.id 
           WHERE m.id = ?`,
          [result.insertId]
        );
        
        if (messages.length > 0) {
          const newMessage = messages[0];
          
          // Send to sender
          socket.emit('receive_message', newMessage);
          
          // Send to receiver if online
          const receiverSocketId = onlineUsers.get(parseInt(receiverId));
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_message', newMessage);
          }
        }
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
        if (callback) callback({ error: 'Failed to send message' });
      }
    });

    // Mark messages as read
    socket.on('mark_as_read', async (data) => {
      try {
        const { conversationId, userId } = data;
        
        // Update read status in database
        await pool.execute(
          `UPDATE messages 
           SET read_status = 1 
           WHERE conversation_id = ? 
           AND sender_id != ?`,
          [conversationId, userId]
        );
        
        // Notify the original sender that their messages were read
        const [results] = await pool.execute(
          `SELECT DISTINCT sender_id FROM messages 
           WHERE conversation_id = ? AND sender_id != ?`,
          [conversationId, userId]
        );
        
        for (const row of results) {
          const senderSocketId = onlineUsers.get(parseInt(row.sender_id));
          if (senderSocketId) {
            io.to(senderSocketId).emit('messages_read', { conversationId, readBy: userId });
          }
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // User typing indicator
    socket.on('typing', (data) => {
      const { conversationId, userId, isTyping } = data;
      
      // Get all participants in the conversation except the user typing
      pool.execute(
        `SELECT user_id FROM conversation_participants 
         WHERE conversation_id = ? AND user_id != ?`,
        [conversationId, userId]
      ).then(([participants]) => {
        participants.forEach(participant => {
          const receiverSocketId = onlineUsers.get(parseInt(participant.user_id));
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_typing', { 
              conversationId, 
              userId, 
              isTyping 
            });
          }
        });
      }).catch(err => console.error('Error getting conversation participants:', err));
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      // Find and remove the disconnected user
      for (const [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          onlineUsers.delete(userId);
          io.emit('user_status', { userId, status: 'offline' });
          break;
        }
      }
    });
  });
};