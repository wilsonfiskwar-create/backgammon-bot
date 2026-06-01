// ========================================
// НАРДЫ — Game Server
// Express + WebSocket + Room Management
// ========================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Backgammon } = require('./game');

const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Room management
const rooms = new Map(); // roomId -> { players, game, state }

// WebSocket server
const wss = new WebSocketServer({ server });

// Client connections
const clients = new Map(); // ws -> { id, roomId, player }

wss.on('connection', (ws) => {
  const clientId = uuidv4().slice(0, 8);
  clients.set(ws, { id: clientId, roomId: null, player: null });

  console.log(`[+] Client ${clientId} connected`);

  ws.send(JSON.stringify({
    type: 'connected',
    clientId
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(ws, msg);
    } catch (e) {
      console.error('[-] Invalid message:', e.message);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    console.log(`[-] Client ${client?.id} disconnected`);
    if (client?.roomId) {
      leaveRoom(ws, client.roomId);
    }
    clients.delete(ws);
  });
});

function handleMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  switch (msg.type) {
    case 'create_room':
      handleCreateRoom(ws);
      break;
    case 'join_room':
      handleJoinRoom(ws, msg.roomId);
      break;
    case 'leave_room':
      leaveRoom(ws, client.roomId);
      break;
    case 'roll_dice':
      handleRollDice(ws);
      break;
    case 'make_move':
      handleMakeMove(ws, msg.move);
      break;
    case 'get_moves':
      handleGetMoves(ws);
      break;
    case 'chat':
      handleChat(ws, msg.text);
      break;
    case 'rematch':
      handleRematch(ws);
      break;
    case 'get_state':
      handleGetState(ws);
      break;
    case 'list_rooms':
      handleListRooms(ws);
      break;
    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Неизвестный тип сообщения' }));
  }
}

function handleCreateRoom(ws) {
  const client = clients.get(ws);
  const roomId = uuidv4().slice(0, 6);

  const game = new Backgammon();

  rooms.set(roomId, {
    id: roomId,
    players: [client.id],
    ws: [ws],
    playerColors: [1], // White
    game,
    state: 'waiting', // waiting, playing, finished
    spectators: [],
    turn: null
  });

  client.roomId = roomId;
  client.player = 1;

  ws.send(JSON.stringify({
    type: 'room_created',
    roomId,
    player: 1
  }));

  console.log(`[+] Room ${roomId} created by ${client.id}`);
}

function handleJoinRoom(ws, roomId) {
  const client = clients.get(ws);
  const room = rooms.get(roomId);

  if (!room) {
    ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
    return;
  }

  if (room.state !== 'waiting' || room.players.length >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Комната уже заполнена или игра началась' }));
    return;
  }

  room.players.push(client.id);
  room.ws.push(ws);
  room.playerColors.push(-1); // Black
  room.state = 'playing';
  client.roomId = roomId;
  client.player = -1;

  ws.send(JSON.stringify({
    type: 'room_joined',
    roomId,
    player: -1,
    opponent: room.players[0]
  }));

  // Notify both players
  const player1 = clients.get(room.ws[0]);
  if (player1) {
    room.ws[0].send(JSON.stringify({
      type: 'opponent_joined',
      opponentId: client.id
    }));
  }

  // Start the game
  broadcastToRoom(roomId, {
    type: 'game_start',
    board: room.game.board,
    currentPlayer: 1,
    player1: room.players[0],
    player2: room.players[1]
  });

  console.log(`[+] ${client.id} joined room ${roomId}`);
  console.log(`[+] Game started in room ${roomId}: ${room.players[0]} vs ${room.players[1]}`);
}

function leaveRoom(ws, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const client = clients.get(ws);

  // Notify other player
  for (const otherWs of room.ws) {
    if (otherWs !== ws && otherWs.readyState === 1) {
      otherWs.send(JSON.stringify({
        type: 'opponent_left',
        message: 'Соперник покинул игру'
      }));
    }
  }

  rooms.delete(roomId);
  if (client) {
    client.roomId = null;
    client.player = null;
  }
  console.log(`[-] Room ${roomId} closed`);
}

function handleRollDice(ws) {
  const client = clients.get(ws);
  if (!client?.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room || room.state !== 'playing') return;

  const game = room.game;

  // Check it's this player's turn
  if (game.currentPlayer !== client.player) {
    ws.send(JSON.stringify({ type: 'error', message: 'Сейчас не ваш ход' }));
    return;
  }

  // Check dice not already rolled
  if (game.dice.length > 0) {
    ws.send(JSON.stringify({ type: 'error', message: 'Кости уже брошены' }));
    return;
  }

  const dice = game.rollDice();
  const legalMoves = game.getLegalMoves();

  broadcastToRoom(client.roomId, {
    type: 'dice_rolled',
    dice,
    currentPlayer: game.currentPlayer,
    legalMoves,
    board: game.board
  });

  // If no legal moves, auto end turn
  if (legalMoves.length === 0) {
    game.dice = [];
    game.diceUsed = [];
    game.currentPlayer = -game.currentPlayer;

    broadcastToRoom(client.roomId, {
      type: 'turn_skipped',
      nextPlayer: game.currentPlayer,
      board: game.board
    });
  }
}

function handleGetMoves(ws) {
  const client = clients.get(ws);
  if (!client?.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) return;

  const legalMoves = room.game.getLegalMoves();
  ws.send(JSON.stringify({
    type: 'legal_moves',
    moves: legalMoves
  }));
}

function handleMakeMove(ws, move) {
  const client = clients.get(ws);
  if (!client?.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room || room.state !== 'playing') return;

  const game = room.game;

  if (game.currentPlayer !== client.player) {
    ws.send(JSON.stringify({ type: 'error', message: 'Сейчас не ваш ход' }));
    return;
  }

  if (game.dice.length === 0) {
    ws.send(JSON.stringify({ type: 'error', message: 'Сначала бросьте кости' }));
    return;
  }

  // Check if move is legal
  const legalMoves = game.getLegalMoves();
  const isLegal = legalMoves.some(m => m.from === move.from && m.to === move.to);

  if (!isLegal && legalMoves.length > 0) {
    ws.send(JSON.stringify({ type: 'error', message: 'Недопустимый ход' }));
    return;
  }

  // Execute the move
  game.makeMove(move.from, move.to);

  const state = {
    type: 'move_made',
    move,
    board: game.board,
    dice: game.dice,
    diceUsed: game.diceUsed,
    currentPlayer: game.currentPlayer,
    playerColor: client.player
  };

  broadcastToRoom(client.roomId, state);

  // Check if player has remaining moves
  const remainingMoves = game.getAvailableDice();

  if (remainingMoves.length === 0) {
    // Check win
    const offIdx = game.currentPlayer === 1 ? 26 : 27;
    if (game.board[offIdx] >= 15) {
      // Player who just moved won? No, we check AFTER switching
      // Actually makeMove already runs checkWin
    }

    if (game.gameOver) {
      broadcastToRoom(client.roomId, {
        type: 'game_over',
        winner: game.winner,
        board: game.board
      });
      room.state = 'finished';
    } else {
      // End turn
      const oldPlayer = game.currentPlayer;
      game.dice = [];
      game.diceUsed = [];
      game.currentPlayer = -oldPlayer;

      broadcastToRoom(client.roomId, {
        type: 'turn_changed',
        nextPlayer: game.currentPlayer,
        board: game.board
      });
    }
  } else {
    // Check if remaining dice can be used
    const newLegalMoves = game.getLegalMoves();
    if (newLegalMoves.length === 0) {
      // Auto end turn - no valid moves with remaining dice
      game.dice = [];
      game.diceUsed = [];
      game.currentPlayer = -game.currentPlayer;

      broadcastToRoom(client.roomId, {
        type: 'turn_skipped',
        nextPlayer: game.currentPlayer,
        board: game.board
      });
    } else {
      broadcastToRoom(client.roomId, {
        type: 'move_again',
        remainingDice: remainingMoves,
        legalMoves: newLegalMoves,
        board: game.board
      });
    }
  }
}

function handleGetState(ws) {
  const client = clients.get(ws);
  if (!client?.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) return;

  ws.send(JSON.stringify({
    type: 'game_state',
    ...room.game.getState(),
    player: client.player,
    roomId: client.roomId,
    state: room.state
  }));
}

function handleChat(ws, text) {
  const client = clients.get(ws);
  if (!client?.roomId || !text?.trim()) return;

  broadcastToRoom(client.roomId, {
    type: 'chat',
    from: client.id,
    text: text.trim()
  });
}

function handleRematch(ws) {
  const client = clients.get(ws);
  if (!client?.roomId) return;

  const room = rooms.get(client.roomId);
  if (!room) return;

  room.game = new Backgammon();
  room.state = 'playing';

  broadcastToRoom(client.roomId, {
    type: 'rematch',
    board: room.game.board,
    currentPlayer: 1
  });
}

function handleListRooms(ws) {
  const roomList = [];
  for (const [id, room] of rooms) {
    roomList.push({
      id,
      players: room.players.length,
      state: room.state
    });
  }
  ws.send(JSON.stringify({ type: 'room_list', rooms: roomList }));
}

// Broadcast to all players in a room
function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const ws of room.ws) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

// Start server
const PORT = process.env.PORT || 3033;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[🎲] НАРДЫ — сервер запущен на порту ${PORT}`);
  console.log(`[🌐] http://0.0.0.0:${PORT}`);
});
