// ========================================
// ДЛИННЫЕ НАРДЫ — Game Logic
// Long Backgammon (Russian variant)
// ========================================
//
// Board representation:
// white[0..25] / black[0..25]
//   [0] = off-board (entry)
//   [1..24] = points on the board
//   [25] = borne off / home
//
// Both players move SAME direction: 0 → 1 → 2 → ... → 24 → 25
// Oбa игрока ходят в одну сторону
// No hitting — checkers can share points
// Wall rule: max 5 per point if opponent hasn't passed you
// ========================================

class LongBackgammon {
  constructor() {
    this.reset();
  }

  reset() {
    // 15 checkers off-board for each player
    this.white = new Array(26).fill(0);
    this.black = new Array(26).fill(0);
    this.white[0] = 15;
    this.black[0] = 15;

    this.currentPlayer = 1; // 1 = white, -1 = black
    this.dice = [];
    this.diceUsed = [];
    this.gameOver = false;
    this.winner = 0;
    this.moveHistory = [];

    // Time control: 3 minutes each, 20-second free per move
    this.whiteClock = 180000; // 3 min in ms
    this.blackClock = 180000;
    this.rollTimestamp = 0;   // When dice were rolled (ms)
    this.lostOnTime = false;
  }

  // ---------- HELPERS ----------

  getBoard(player) {
    return player === 1 ? this.white : this.black;
  }

  getOpponentBoard(player) {
    return player === -1 ? this.white : this.black;
  }

  // Find the furthest point a player has occupied (1-24)
  // Returns 0 if all checkers are off-board or at home
  getFurthestPoint(player) {
    const board = this.getBoard(player);
    for (let p = 24; p >= 1; p--) {
      if (board[p] > 0) return p;
    }
    return 0;
  }

  // Has opponent passed (is ahead of) the given player?
  // "Опередил" — opponent's furthest checker is ahead of player's furthest
  hasOpponentPassed(player) {
    const myFurthest = this.getFurthestPoint(player);
    const oppFurthest = this.getFurthestPoint(-player);
    return oppFurthest > myFurthest;
  }

  // How many checkers of 'player' are on point 'point'
  countOnPoint(player, point) {
    const board = this.getBoard(player);
    return board[point];
  }

  // Can player place N checkers on this point? (wall rule)
  canPlaceOnPoint(player, point, newCount) {
    if (newCount <= 5) return true; // 5 or fewer always OK
    // 6+ checkers only if opponent has passed this player
    return this.hasOpponentPassed(player);
  }

  // Check if all checkers are in home (points 19-24)
  isAllInHome(player) {
    const board = this.getBoard(player);
    if (board[0] > 0) return false; // Still has checkers off-board
    for (let p = 1; p <= 18; p++) {
      if (board[p] > 0) return false; // Checker outside home
    }
    // All checkers are in points 19-24 or already borne off
    const inHome = board.slice(19, 25).reduce((a, b) => a + b, 0);
    const borneOff = board[25];
    return (inHome + borneOff) === 15;
  }

  // Get available (unused) dice
  getAvailableDice() {
    return this.dice.filter((_, i) => !this.diceUsed[i]);
  }

  // ---------- DICE ----------

  rollDice() {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    this.dice = [d1, d2];
    this.diceUsed = [false, false];

    // Doubles: play 4 moves of the same value
    if (d1 === d2) {
      this.dice = [d1, d1, d1, d1];
      this.diceUsed = [false, false, false, false];
    }

    // Start timing this move (20s free)
    this.rollTimestamp = Date.now();

    return this.dice;
  }

  // Check if player has exceeded the 20-second free time
  // Returns: { overtime: ms (0 if within limit), clockRemaining: ms }
  checkTime(player) {
    const elapsed = Date.now() - this.rollTimestamp;
    const overtime = Math.max(0, elapsed - 20000); // 20s free
    const clock = player === 1 ? this.whiteClock : this.blackClock;
    const remaining = clock - overtime;
    return { overtime, clockRemaining: Math.max(0, remaining), remainingSec: Math.max(0, Math.floor(remaining / 1000)) };
  }

  // Deduct overtime from player's clock after a move
  // Returns: true if still has time, false if lost on time
  deductTime(player) {
    const { overtime } = this.checkTime(player);
    if (overtime > 0) {
      if (player === 1) {
        this.whiteClock = Math.max(0, this.whiteClock - overtime);
        if (this.whiteClock <= 0) {
          this.gameOver = true;
          this.winner = -1; // Player 1 ran out of time = player 2 wins
          this.lostOnTime = true;
          return false;
        }
      } else {
        this.blackClock = Math.max(0, this.blackClock - overtime);
        if (this.blackClock <= 0) {
          this.gameOver = true;
          this.winner = 1;
          this.lostOnTime = true;
          return false;
        }
      }
    }
    return true;
  }

  // ---------- MOVE GENERATION ----------

  // Get all legal moves for the current player
  getLegalMoves() {
    const player = this.currentPlayer;
    const board = this.getBoard(player);
    const availableDice = this.getAvailableDice();
    if (availableDice.length === 0) return [];

    const uniqueDice = [...new Set(availableDice)];
    const moves = [];

    // Check if any checkers off-board (need to enter)
    if (board[0] > 0) {
      // Must enter checkers first — ENTRY PHASE
      for (const die of uniqueDice) {
        const targetPoint = die; // Enter at point matching die value
        if (targetPoint >= 1 && targetPoint <= 24) {
          const currCount = this.countOnPoint(player, targetPoint);
          const newCount = currCount + 1;
          if (this.canPlaceOnPoint(player, targetPoint, newCount)) {
            moves.push({
              type: 'enter',
              from: 0,
              to: targetPoint,
              die,
              description: `Зайти на пункт ${targetPoint}`
            });
          }
        }
      }
      // If CAN enter but choose not to — not allowed, must enter if possible
      // Actually in Long Backgammon: if you can enter, you MUST enter
      // So return only entry moves
      return moves;
    }

    // Check if all in home — BEARING OFF
    if (this.isAllInHome(player)) {
      for (const die of uniqueDice) {
        const from = 25 - die; // die 1 → from 24, die 2 → from 23, etc.
        if (from >= 19 && from <= 24 && board[from] > 0) {
          moves.push({
            type: 'bear_off',
            from,
            to: 25,
            die,
            description: `Выбросить с пункта ${from}`
          });
        } else if (from >= 19) {
          // Checker at exact position? If not, try highest occupied
          for (let p = 24; p >= 19; p--) {
            if (board[p] > 0) {
              moves.push({
                type: 'bear_off',
                from: p,
                to: 25,
                die,
                description: `Выбросить с пункта ${p} (кость ${die})`
              });
              break;
            }
          }
        }
      }
      return moves;
    }

    // NORMAL MOVEMENT
    for (const die of uniqueDice) {
      for (let from = 1; from <= 24; from++) {
        if (board[from] === 0) continue; // No checker here

        const to = from + die;
        if (to > 24) continue; // Can't move past end (unless bearing off)

        // Check if destination allows the move
        // In Long Backgammon: any destination is OK (shared points)
        // But check wall rule — check if moving FROM this point would leave us with
        // too many checkers? No, it reduces from that point.
        // Check destination wall: moving TO this point adds a checker
        const currCount = this.countOnPoint(player, to);
        const newCount = currCount + 1;
        if (!this.canPlaceOnPoint(player, to, newCount)) continue;

        moves.push({
          type: 'move',
          from,
          to,
          die,
          description: `${from} → ${to} (${die})`
        });
      }
    }

    return moves;
  }

  // ---------- EXECUTE MOVE ----------

  makeMove(from, to) {
    const player = this.currentPlayer;
    const board = this.getBoard(player);

    // Find which die was used
    const diff = to - from;
    let usedDie = 0;

    if (from === 0) {
      // Entry move: die = destination point
      usedDie = to;
    } else if (to === 25) {
      // Bear off: determine which die
      usedDie = 25 - from; // e.g., from 24 → die 1
      // But if there's no exact match, find the die
      if (usedDie < 1 || usedDie > 6) {
        const avail = this.getAvailableDice();
        usedDie = avail[0]; // Use first available
      }
    } else {
      // Normal move: die = difference
      usedDie = diff;
    }

    // Mark die as used
    const avail = this.getAvailableDice();
    // Find matching die in available list
    let dieIndex = -1;
    for (let i = 0; i < this.dice.length; i++) {
      if (!this.diceUsed[i] && this.dice[i] === usedDie) {
        dieIndex = i;
        break;
      }
    }
    if (dieIndex === -1) {
      // Fallback: use the first available
      for (let i = 0; i < this.dice.length; i++) {
        if (!this.diceUsed[i]) {
          dieIndex = i;
          break;
        }
      }
    }
    if (dieIndex >= 0) {
      this.diceUsed[dieIndex] = true;
    }

    // Execute the move
    board[from]--;
    if (to <= 25) {
      board[to]++;
    }

    // Deduct time for this move
    this.deductTime(player);

    // If lost on time, game over immediately
    if (this.lostOnTime) {
      return true;
    }

    this.moveHistory.push({
      player,
      from,
      to,
      die: usedDie
    });

    // Check if all dice used
    const remaining = this.getAvailableDice();
    if (remaining.length > 0 && this.getLegalMoves().length > 0) {
      // Still have moves available
      return false;
    }

    // Check win
    if (board[25] >= 15) {
      this.gameOver = true;
      this.winner = player;
      return true;
    }

    // Switch turn
    this.endTurn();
    return true;
  }

  // End current player's turn
  endTurn() {
    this.dice = [];
    this.diceUsed = [];
    this.currentPlayer = -this.currentPlayer;
  }

  // Get full state for display
  // Virtual getter for backward compatibility with server
  get board() {
    return this.getState();
  }

  getState() {
    return {
      white: [...this.white],
      black: [...this.black],
      currentPlayer: this.currentPlayer,
      dice: [...this.dice],
      diceUsed: [...this.diceUsed],
      gameOver: this.gameOver,
      winner: this.winner,
      whiteClock: this.whiteClock,
      blackClock: this.blackClock,
      rollTimestamp: this.rollTimestamp,
      lostOnTime: this.lostOnTime
    };
  }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LongBackgammon };
}
