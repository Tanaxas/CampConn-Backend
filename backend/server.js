const app = require('./app');
const http = require('http');
const socketIo = require('socket.io');
const { testConnection } = require('./config/db');
require('dotenv').config();

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Test database connection
testConnection();

// Socket.io setup
require('./socket')(io);

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});