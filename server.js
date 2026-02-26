const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { randomInt } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 10000,   // detect dead connections faster than the 20s default
  upgradeTimeout: 10000 // limit time allowed for the WS upgrade handshake
});

app.set('trust proxy', 1); // trust Railway's reverse proxy
app.use(express.static(path.join(__dirname, 'public')));

// ── Categories & Words ─────────────────────────────────────────────
const CATEGORIES = {
  "Pop Culture": [
    "Beyoncé", "Taylor Swift", "Marvel", "TikTok", "Netflix",
    "iPhone", "YouTube", "Kanye West", "Kim Kardashian", "Instagram",
    "Disney", "Harry Styles", "Rihanna", "Adele", "BTS",
    "Dua Lipa", "Elon Musk", "Billie Eilish", "Zendaya", "Bad Bunny"
  ],
  "TV Shows": [
    "Stranger Things", "Breaking Bad", "Friends", "Game of Thrones",
    "The Office", "Grey's Anatomy", "Squid Game", "Wednesday",
    "Euphoria", "The Crown", "Succession", "Ozark",
    "The Mandalorian", "Black Mirror", "Ted Lasso",
    "Yellowstone", "The Bear", "White Lotus", "House of Dragon", "Severance"
  ],
  "Movies": [
    "Titanic", "Avatar", "The Dark Knight", "Inception",
    "Avengers", "Jurassic Park", "Star Wars", "The Lion King",
    "Frozen", "Harry Potter", "Top Gun", "Interstellar",
    "Gladiator", "The Matrix", "Barbie",
    "Oppenheimer", "Dune", "Everything Everywhere", "Parasite", "Get Out"
  ],
  "Sports": [
    "Soccer", "Basketball", "Tennis", "Swimming",
    "Baseball", "Golf", "Boxing", "Olympics",
    "Super Bowl", "World Cup", "NFL", "NBA",
    "Formula 1", "Gymnastics", "Volleyball",
    "Hockey", "Wrestling", "MMA", "Marathon", "Skateboarding"
  ],
  "random": [
    "goon", "blanca", "pooper", "raymonds",
    "christycream", "realms", "mr.rohner", "is it sweaty",
    "charles", "nina", "milo", "black people",
    "makenzie(joeys ebony sister)"
  ]
};

// ── Room Store ─────────────────────────────────────────────────────
const rooms = {};

// Tracks pending disconnect timers so we can cancel them on reconnect
const disconnectTimers = {};

function randomCode() {
  // Avoid 0/O, 1/I for readability
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('');
}

// ── Socket Logic ───────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── Create Room ──
  socket.on('create-room', ({ playerName }) => {
    let code;
    do { code = randomCode(); } while (rooms[code]);

    const player = { id: socket.id, name: playerName, isHost: true };
    rooms[code] = {
      host: socket.id,
      players: [player],
      gameState: 'lobby',   // lobby | playing | ended
      category: null,
      secretWord: null,
      imposterId: null,
      roles: {}
    };

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = playerName;

    socket.emit('room-created', {
      roomCode: code,
      players: rooms[code].players,
      categories: Object.keys(CATEGORIES)
    });
  });

  // ── Join Room ──
  socket.on('join-room', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room)
      return socket.emit('game-error', { message: 'Room not found. Check the code and try again.' });
    if (room.gameState !== 'lobby')
      return socket.emit('game-error', { message: 'A game is already in progress in this room.' });
    if (room.players.some(p => p.name === playerName))
      return socket.emit('game-error', { message: 'That name is already taken. Pick a different name.' });
    if (room.players.length >= 12)
      return socket.emit('game-error', { message: 'Room is full (max 12 players).' });

    const player = { id: socket.id, name: playerName, isHost: false };
    room.players.push(player);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    socket.emit('room-joined', {
      roomCode,
      players: room.players,
      categories: Object.keys(CATEGORIES)
    });

    // Notify everyone else
    io.to(roomCode).emit('players-updated', { players: room.players });
  });

  // ── Start Game ──
  socket.on('start-game', ({ category }) => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room)
      return socket.emit('game-error', { message: 'Room not found. Please refresh and rejoin.' });
    if (room.host !== socket.id) return;
    if (room.gameState !== 'lobby') return;
    if (!CATEGORIES[category])
      return socket.emit('game-error', { message: 'Invalid category.' });
    if (room.players.length < 2)
      return socket.emit('game-error', { message: 'Need at least 2 players to start.' });

    const words = CATEGORIES[category];
    const secretWord = words[randomInt(words.length)];
    const imposterIndex = randomInt(room.players.length);

    room.category = category;
    room.secretWord = secretWord;
    room.imposterId = room.players[imposterIndex].id;
    room.gameState = 'playing';
    room.roles = {};

    room.players.forEach(p => {
      room.roles[p.id] = {
        isImposter: p.id === room.imposterId,
        word: p.id === room.imposterId ? null : secretWord
      };
    });

    io.to(roomCode).emit('game-started', { category });
  });

  // ── Get My Role (private — only returned to requesting socket) ──
  socket.on('get-my-role', () => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room || !room.roles[socket.id]) return;
    socket.emit('your-role', room.roles[socket.id]);
  });

  // ── Chat ──
  socket.on('chat-message', ({ text }) => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room || room.gameState === 'ended') return;
    const name = socket.data.playerName;
    if (typeof text !== 'string') return;
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return;
    io.to(roomCode).emit('chat-message', { name, text: trimmed });
  });

  // ── End Game (imposter or host can trigger) ──
  socket.on('end-game', () => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room) return;
    if (room.imposterId !== socket.id && room.host !== socket.id) return;

    const imposterPlayer = room.players.find(p => p.id === room.imposterId);
    room.gameState = 'ended';

    io.to(roomCode).emit('game-ended', {
      secretWord: room.secretWord,
      imposterName: imposterPlayer ? imposterPlayer.name : 'Unknown',
      category: room.category
    });
  });

  // ── Play Again (host only) ──
  socket.on('play-again', () => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room || room.host !== socket.id) return;

    room.gameState = 'lobby';
    room.category = null;
    room.secretWord = null;
    room.imposterId = null;
    room.roles = {};

    io.to(roomCode).emit('reset-game', {
      players: room.players,
      categories: Object.keys(CATEGORIES)
    });
  });

  // ── Rejoin Room (after reconnection) ──
  socket.on('rejoin-room', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('rejoin-failed', { message: 'Room no longer exists.' });

    const existingPlayer = room.players.find(p => p.name === playerName);
    if (!existingPlayer) return socket.emit('rejoin-failed', { message: 'Could not rejoin — please re-enter the room.' });

    const oldSocketId = existingPlayer.id;

    // Cancel the pending removal timer for this player
    if (disconnectTimers[oldSocketId]) {
      clearTimeout(disconnectTimers[oldSocketId]);
      delete disconnectTimers[oldSocketId];
    }

    // Remap all old socket.id references to the new socket.id
    existingPlayer.id = socket.id;
    if (room.host === oldSocketId)     room.host = socket.id;
    if (room.imposterId === oldSocketId) room.imposterId = socket.id;
    if (room.roles[oldSocketId]) {
      room.roles[socket.id] = room.roles[oldSocketId];
      delete room.roles[oldSocketId];
    }

    socket.join(roomCode);
    socket.data.roomCode   = roomCode;
    socket.data.playerName = playerName;

    socket.emit('rejoined-room', {
      roomCode,
      players:   room.players,
      categories: Object.keys(CATEGORIES),
      gameState: room.gameState,
      category:  room.category
    });

    io.to(roomCode).emit('players-updated', { players: room.players });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const roomCode   = socket.data.roomCode;
    if (!roomCode || !rooms[roomCode]) return;

    // Give the player 10 seconds to reconnect before removing them.
    // If they reconnect and emit 'rejoin-room' the timer is cancelled above.
    disconnectTimers[socket.id] = setTimeout(() => {
      delete disconnectTimers[socket.id];

      const room = rooms[roomCode];
      if (!room) return;

      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.roles[socket.id]; // clean up stale role data

      if (room.players.length === 0) {
        delete rooms[roomCode];
        return;
      }

      // Transfer host if host left
      if (room.host === socket.id) {
        room.host = room.players[0].id;
        room.players[0].isHost = true;
      }

      io.to(roomCode).emit('players-updated', { players: room.players });
    }, 10000); // 10-second grace period
  });
});

// ── Start Server ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  IMPOSTER game running at http://localhost:${PORT}\n`);
});
