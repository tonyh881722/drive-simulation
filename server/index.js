const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameManager } = require('./gameLoop');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static client files
app.use(express.static(path.join(__dirname, '../client')));

const gameManager = new GameManager(io);

// Track which room each socket belongs to
const socketRooms = {}; // socketId -> roomId

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('join', ({ roomId, role }) => {
    if (!roomId || !['dashboard', 'wheel'].includes(role)) {
      socket.emit('error', { message: 'Invalid room or role' });
      return;
    }

    const room = gameManager.getOrCreate(roomId);

    // Check if role is already taken
    const rolesTaken = Object.values(room.clients).map(c => c.role);
    if (rolesTaken.includes(role)) {
      socket.emit('error', { message: `Role "${role}" already taken in room ${roomId}` });
      return;
    }

    socket.join(roomId);
    socketRooms[socket.id] = roomId;
    room.addClient(socket.id, role);

    socket.emit('joined', { roomId, role });
    console.log(`[room:${roomId}] ${role} joined (${socket.id})`);

    // Notify others in room
    socket.to(roomId).emit('peer_joined', { role });

    // Notify newcomer about peers already in the room
    const peerRole = role === 'dashboard' ? 'wheel' : 'dashboard';
    const peerExists = Object.values(room.clients).some(c => c.role === peerRole);
    if (peerExists) {
      socket.emit('peer_joined', { role: peerRole });
    }
  });

  socket.on('input', (data) => {
    const roomId = socketRooms[socket.id];
    if (!roomId) return;
    const room = gameManager.rooms[roomId];
    if (!room) return;
    const client = room.clients[socket.id];
    if (!client) return;
    room.handleInput(client.role, data);
  });

  socket.on('disconnect', () => {
    const roomId = socketRooms[socket.id];
    if (roomId) {
      const room = gameManager.rooms[roomId];
      if (room) {
        const client = room.clients[socket.id];
        const role = client ? client.role : null;
        room.removeClient(socket.id);
        io.to(roomId).emit('peer_left', { role });
        gameManager.cleanup(roomId);
      }
      delete socketRooms[socket.id];
    }
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Drive Simulation server running at http://0.0.0.0:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);

  // Show LAN IP for phone access
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`LAN access (phone): http://${net.address}:${PORT}`);
      }
    }
  }
});
