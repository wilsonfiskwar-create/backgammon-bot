// ========================================
// НАРДЫ — Game Server
// Express + HTTP API + WebSocket fallback
// ========================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Backgammon } = require('./game');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Room management
const rooms = new Map(); // roomId -> { players, game, state, seq, events[] }

// WebSocket server (fallback)
const wss = new WebSocketServer({ server });
const wsClients = new Map(); // ws -> { id, roomId, player }

// ============================================
// HTTP API
// ============================================

app.post('/api/create', (req, res) => {
  const playerId = uuidv4().slice(0, 8);
  const roomId = uuidv4().slice(0, 6);
  const game = new Backgammon();

  rooms.set(roomId, {
    id: roomId,
    players: [playerId],
    playerSessions: [{ playerId, player: 1 }],
    game,
    state: 'waiting', // waiting, playing, finished
    seq: 0,
    events: []
  });

  console.log(`[HTTP] [+] Room ${roomId} created by ${playerId}`);

  res.json({ roomId, playerId, player: 1 });
});

app.post('/api/join', (req, res) => {
  const { roomId } = req.body;
  const room = rooms.get(roomId);

  if (!room) {
    return res.status(404).json({ error: 'Комната не найдена' });
  }

  if (room.state !== 'waiting' || room.players.length >= 2) {
    return res.status(400).json({ error: 'Комната уже заполнена или игра началась' });
  }

  const playerId = uuidv4().slice(0, 8);
  room.players.push(playerId);
  room.playerSessions.push({ playerId, player: -1 });
  room.state = 'playing';
  room.seq++;

  // Push events
  room.events.push({ type: 'opponent_joined', opponentId: playerId, seq: room.seq });
  room.events.push({
    type: 'game_start', seq: room.seq,
    board: room.game.board, currentPlayer: 1,
    player1: room.players[0], player2: room.players[1]
  });

  console.log(`[HTTP] [+] ${playerId} joined room ${roomId}`);

  res.json({
    roomId, playerId, player: -1,
    opponent: room.players[0],
    board: room.game.board,
    currentPlayer: 1
  });
});

app.post('/api/roll', (req, res) => {
  const { roomId, playerId } = req.body;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });

  const session = room.playerSessions.find(s => s.playerId === playerId);
  if (!session) return res.status(403).json({ error: 'Не авторизован' });

  const game = room.game;
  if (game.currentPlayer !== session.player) {
    return res.status(400).json({ error: 'Сейчас не ваш ход' });
  }
  if (game.dice.length > 0) {
    return res.status(400).json({ error: 'Кости уже брошены' });
  }

  const dice = game.rollDice();
  const legalMoves = game.getLegalMoves();
  room.seq++;

  room.events.push({
    type: 'dice_rolled', seq: room.seq,
    dice, currentPlayer: game.currentPlayer,
    legalMoves, board: game.board
  });

  // If no legal moves, auto end turn
  if (legalMoves.length === 0) {
    game.dice = [];
    game.diceUsed = [];
    game.currentPlayer = -game.currentPlayer;
    room.seq++;
    room.events.push({
      type: 'turn_skipped', seq: room.seq,
      nextPlayer: game.currentPlayer, board: game.board
    });
  }

  res.json({ dice, legalMoves, board: game.board, currentPlayer: game.currentPlayer });
});

app.post('/api/move', (req, res) => {
  const { roomId, playerId, from, to } = req.body;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });

  const session = room.playerSessions.find(s => s.playerId === playerId);
  if (!session) return res.status(403).json({ error: 'Не авторизован' });

  const game = room.game;
  if (game.currentPlayer !== session.player) {
    return res.status(400).json({ error: 'Сейчас не ваш ход' });
  }
  if (game.dice.length === 0) {
    return res.status(400).json({ error: 'Сначала бросьте кости' });
  }

  const legalMoves = game.getLegalMoves();
  const isLegal = legalMoves.some(m => m.from === from && m.to === to);
  if (!isLegal && legalMoves.length > 0) {
    return res.status(400).json({ error: 'Недопустимый ход' });
  }

  // Execute the move
  game.makeMove(from, to);
  room.seq++;

  room.events.push({
    type: 'move_made', seq: room.seq,
    move: { from, to },
    board: game.board, dice: game.dice,
    diceUsed: game.diceUsed,
    currentPlayer: game.currentPlayer
  });

  // Check for remaining moves
  const remainingMoves = game.getAvailableDice();
  let response = { board: game.board, dice: game.dice, diceUsed: game.diceUsed };

  if (remainingMoves.length === 0) {
    if (game.gameOver) {
      room.seq++;
      room.events.push({ type: 'game_over', seq: room.seq, winner: game.winner, board: game.board });
      room.state = 'finished';
      response.gameOver = true;
      response.winner = game.winner;
    } else {
      const oldPlayer = game.currentPlayer;
      game.dice = [];
      game.diceUsed = [];
      game.currentPlayer = -oldPlayer;
      room.seq++;
      room.events.push({ type: 'turn_changed', seq: room.seq, nextPlayer: game.currentPlayer, board: game.board });
      response.turnChanged = true;
      response.nextPlayer = game.currentPlayer;
    }
  } else {
    const newLegalMoves = game.getLegalMoves();
    if (newLegalMoves.length === 0) {
      game.dice = [];
      game.diceUsed = [];
      game.currentPlayer = -game.currentPlayer;
      room.seq++;
      room.events.push({ type: 'turn_skipped', seq: room.seq, nextPlayer: game.currentPlayer, board: game.board });
      response.turnSkipped = true;
      response.nextPlayer = game.currentPlayer;
    } else {
      room.seq++;
      room.events.push({
        type: 'move_again', seq: room.seq,
        remainingDice: remainingMoves,
        legalMoves: newLegalMoves, board: game.board
      });
      response.moveAgain = true;
      response.legalMoves = newLegalMoves;
    }
  }

  res.json(response);
});

// Poll for state changes
app.get('/api/state', (req, res) => {
  const { roomId, playerId, seq } = req.query;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });

  const currentSeq = room.seq;
  const lastSeq = parseInt(seq) || 0;

  // Get new events since lastSeq
  const newEvents = room.events.filter(e => e.seq > lastSeq);

  // Get player info
  const session = room.playerSessions.find(s => s.playerId === playerId);

  res.json({
    seq: currentSeq,
    changed: newEvents.length > 0,
    events: newEvents,
    player: session ? session.player : null,
    roomState: room.state
  });
});

// ============================================
// WebSocket fallback (kept for compatibility)
// ============================================

wsClients.set = function(ws, data) {
  this.set(ws, data);
};

wsClients.get = function(ws) {
  return Map.prototype.get.call(this, ws);
};

wsClients.delete = function(ws) {
  return Map.prototype.delete.call(this, ws);
};

wss.on('connection', (ws) => {
  const clientId = uuidv4().slice(0, 8);
  const data = { id: clientId, roomId: null, player: null };
  wsClients.set(ws, data);

  console.log(`[WS] [+] Client ${clientId} connected`);

  ws.send(JSON.stringify({ type: 'connected', clientId }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleWSMessage(ws, msg);
    } catch (e) {
      console.error('[-] WS invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    const client = wsClients.get(ws);
    console.log(`[WS] [-] Client ${client?.id} disconnected`);
    if (client?.roomId) {
      leaveRoom(ws, client.roomId);
    }
    wsClients.delete(ws);
  });
});

function handleWSMessage(ws, msg) {
  const client = wsClients.get(ws);
  if (!client) return;

  switch (msg.type) {
    case 'create_room':
      handleWSCreateRoom(ws);
      break;
    case 'join_room':
      handleWSJoinRoom(ws, msg.roomId);
      break;
    case 'leave_room':
      leaveRoom(ws, client.roomId);
      break;
    case 'roll_dice':
      handleWSRollDice(ws);
      break;
    case 'make_move':
      handleWSMakeMove(ws, msg.move);
      break;
    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Неизвестный тип' }));
  }
}

function handleWSCreateRoom(ws) {
  const client = wsClients.get(ws);
  const roomId = uuidv4().slice(0, 6);
  const game = new Backgammon();
  rooms.set(roomId, {
    id: roomId, players: [client.id], ws: [ws],
    playerColors: [1], game, state: 'waiting',
    seq: 0, events: [],
    playerSessions: [{ playerId: client.id, player: 1 }]
  });
  client.roomId = roomId;
  client.player = 1;
  ws.send(JSON.stringify({ type: 'room_created', roomId, player: 1 }));
  console.log(`[WS] [+] Room ${roomId} created`);
}

function handleWSJoinRoom(ws, roomId) {
  const client = wsClients.get(ws);
  const room = rooms.get(roomId);
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
    return;
  }
  if (room.state !== 'waiting' || room.players.length >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Комната уже заполнена' }));
    return;
  }
  room.players.push(client.id);
  if (!room.ws) room.ws = [];
  room.ws.push(ws);
  room.playerColors.push(-1);
  room.state = 'playing';
  client.roomId = roomId;
  client.player = -1;

  ws.send(JSON.stringify({ type: 'room_joined', roomId, player: -1, opponent: room.players[0] }));

  if (room.ws[0]) {
    room.ws[0].send(JSON.stringify({ type: 'opponent_joined', opponentId: client.id }));
  }

  broadcastToRoom(roomId, {
    type: 'game_start', board: room.game.board, currentPlayer: 1,
    player1: room.players[0], player2: room.players[1]
  });
}

function handleWSRollDice(ws) {
  const client = wsClients.get(ws);
  if (!client?.roomId) return;
  const room = rooms.get(client.roomId);
  if (!room || room.state !== 'playing') return;
  if (room.game.currentPlayer !== client.player) {
    ws.send(JSON.stringify({ type: 'error', message: 'Сейчас не ваш ход' }));
    return;
  }
  const dice = room.game.rollDice();
  const legalMoves = room.game.getLegalMoves();
  broadcastToRoom(client.roomId, { type: 'dice_rolled', dice, currentPlayer: room.game.currentPlayer, legalMoves, board: room.game.board });

  if (legalMoves.length === 0) {
    room.game.dice = [];
    room.game.diceUsed = [];
    room.game.currentPlayer = -room.game.currentPlayer;
    broadcastToRoom(client.roomId, { type: 'turn_skipped', nextPlayer: room.game.currentPlayer, board: room.game.board });
  }
}

function handleWSMakeMove(ws, move) {
  const client = wsClients.get(ws);
  if (!client?.roomId) return;
  const room = rooms.get(client.roomId);
  if (!room || room.state !== 'playing' || room.game.currentPlayer !== client.player) return;

  room.game.makeMove(move.from, move.to);
  const state = { type: 'move_made', move, board: room.game.board, dice: room.game.dice, diceUsed: room.game.diceUsed, currentPlayer: room.game.currentPlayer };
  broadcastToRoom(client.roomId, state);

  const remainingMoves = room.game.getAvailableDice();
  if (remainingMoves.length === 0) {
    if (room.game.gameOver) {
      broadcastToRoom(client.roomId, { type: 'game_over', winner: room.game.winner, board: room.game.board });
      room.state = 'finished';
    } else {
      room.game.dice = [];
      room.game.diceUsed = [];
      room.game.currentPlayer = -room.game.currentPlayer;
      broadcastToRoom(client.roomId, { type: 'turn_changed', nextPlayer: room.game.currentPlayer, board: room.game.board });
    }
  } else {
    const newLegalMoves = room.game.getLegalMoves();
    if (newLegalMoves.length === 0) {
      room.game.dice = [];
      room.game.diceUsed = [];
      room.game.currentPlayer = -room.game.currentPlayer;
      broadcastToRoom(client.roomId, { type: 'turn_skipped', nextPlayer: room.game.currentPlayer, board: room.game.board });
    } else {
      broadcastToRoom(client.roomId, { type: 'move_again', remainingDice: remainingMoves, legalMoves: newLegalMoves, board: room.game.board });
    }
  }
}

function leaveRoom(ws, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const otherWs of room.ws || []) {
    if (otherWs !== ws && otherWs.readyState === 1) {
      otherWs.send(JSON.stringify({ type: 'opponent_left', message: 'Соперник покинул игру' }));
    }
  }
  rooms.delete(roomId);
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room || !room.ws) return;
  const data = JSON.stringify(message);
  for (const ws of room.ws) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// ============================================
// Start server
// ============================================

const PORT = process.env.PORT || 3033;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[🎲] НАРДЫ — сервер на порту ${PORT}`);
  console.log(`[🌐] http://localhost:${PORT}`);
});
