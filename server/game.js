// ========================================
// НАРДЫ — Backgammon Game Logic
// Короткие нарды (Standard Backgammon)
// ========================================

// Board representation:
// board[1..24] = points (positive = white, negative = black)
// board[0] = white bar (checkers hit)
// board[25] = black bar
// board[26] = white borne off
// board[27] = black borne off

const POINTS = 24;
const BAR_W = 0;
const BAR_B = 25;
const OFF_W = 26;
const OFF_B = 27;

class Backgammon {
  constructor() {
    this.reset();
  }

  reset() {
    // Standard backgammon starting position
    this.board = new Array(28).fill(0);
    // White (positive)
    this.board[1] = 2;
    this.board[12] = 5;
    this.board[17] = 3;
    this.board[19] = 5;
    // Black (negative)
    this.board[6] = -5;
    this.board[8] = -3;
    this.board[13] = -5;
    this.board[24] = -2;

    this.currentPlayer = 1; // 1 = white, -1 = black
    this.dice = [];
    this.diceUsed = [];
    this.gameOver = false;
    this.winner = 0;
    this.moveHistory = [];
    this.doublingCube = 1;
    this.doubleOffered = false;
    this.doubleBy = null;
  }

  // Roll dice
  rollDice() {
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    this.dice = [d1, d2];
    this.diceUsed = [false, false];

    // Doubles: play 4 moves
    if (d1 === d2) {
      this.dice = [d1, d1, d1, d1];
      this.diceUsed = [false, false, false, false];
    }

    return this.dice;
  }

  // Get the current dice available (unused)
  getAvailableDice() {
    return this.dice.filter((_, i) => !this.diceUsed[i]);
  }

  // Get all legal moves for the current player
  getLegalMoves() {
    const player = this.currentPlayer;
    const availableDice = this.getAvailableDice();
    if (availableDice.length === 0) return [];

    const allMoves = [];
    const boardState = [...this.board];

    // Если есть шашки на баре
    if (this.isOnBar(player)) {
      return this.getBarMoves(player, availableDice);
    }

    // Can bear off?
    const canBearOff = this.canBearOff(player);

    // Generate all possible single moves then combine
    const singleMoves = [];

    for (const die of [...new Set(availableDice)]) {
      for (let from = 1; from <= POINTS; from++) {
        if (this.board[from] * player <= 0) continue; // Not player's checker

        const to = this.getDestination(player, from, die);
        if (to === null) continue; // Invalid move

        // Bearing off
        if (to === OFF_W || to === OFF_B) {
          if (!canBearOff) continue;
          // Must move exact roll to bear off unless no checkers beyond
          if (!this.canBearOffFrom(player, from, die)) continue;
        }

        singleMoves.push({ from, to, die });
      }
    }

    // Deduplicate by (from, to) for same die values
    const uniqueMoves = [];
    const seen = new Set();
    for (const m of singleMoves) {
      const key = `${m.from}-${m.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMoves.push(m);
      }
    }

    return uniqueMoves;
  }

  // Get bar entry moves
  getBarMoves(player, availableDice) {
    const bar = player === 1 ? BAR_W : BAR_B;
    const moves = [];
    for (const die of [...new Set(availableDice)]) {
      const entryPoint = player === 1 ? die : POINTS + 1 - die;
      if (entryPoint < 1 || entryPoint > POINTS) continue;

      // Check if entry point is not blocked (not occupied by 2+ opponent checkers)
      if (this.board[entryPoint] * -player > 1) continue;

      moves.push({ from: bar, to: entryPoint, die });
    }
    return moves;
  }

  // Calculate destination point for a move
  getDestination(player, from, die) {
    if (player === 1) {
      // White moves toward higher points
      const to = from + die;
      if (to > POINTS) {
        // Bearing off
        return OFF_W;
      }
      return to;
    } else {
      // Black moves toward lower points
      const to = from - die;
      if (to < 1) {
        return OFF_B;
      }
      return to;
    }
  }

  // Check if a point is a valid destination
  isValidDestination(player, point) {
    if (point === OFF_W || point === OFF_B) return true;
    if (point < 1 || point > POINTS) return false;
    // Can land on: empty, own checker, or single opponent checker (hit)
    return this.board[point] * -player <= 1;
  }

  // Check if player has checkers on bar
  isOnBar(player) {
    return player === 1 ? this.board[BAR_W] > 0 : this.board[BAR_B] > 0;
  }

  // Check if player can bear off
  canBearOff(player) {
    const homeStart = player === 1 ? 19 : 1;
    const homeEnd = player === 1 ? 24 : 6;

    let totalCheckers = 0;
    let inHome = 0;

    for (let p = 1; p <= POINTS; p++) {
      const c = this.board[p];
      if (c * player > 0) {
        totalCheckers += c * player;
        if (p >= homeStart && p <= homeEnd) {
          inHome += c * player;
        }
      }
    }

    // Also check bar
    const barCheckers = player === 1 ? this.board[BAR_W] : this.board[BAR_B];
    totalCheckers += barCheckers;

    return inHome === totalCheckers && totalCheckers > 0;
  }

  // Check if can bear off from a specific point
  canBearOffFrom(player, from, die) {
    if (player === 1) {
      // White: can bear off from point 19-24, need exact roll or higher if no checker beyond
      if (from + die === POINTS + 1) return true;
      if (from + die > POINTS + 1) {
        // Need to check if there are no checkers beyond this point
        for (let p = from + 1; p <= POINTS; p++) {
          if (this.board[p] * player > 0) return false;
        }
        return true;
      }
      return false;
    } else {
      if (from - die === 0) return true;
      if (from - die < 0) {
        for (let p = from - 1; p >= 1; p--) {
          if (this.board[p] * player > 0) return false;
        }
        return true;
      }
      return false;
    }
  }

  // Make a move
  makeMove(from, to) {
    const player = this.currentPlayer;
    const board = this.board;

    // Remove checker from source
    if (from === BAR_W || from === BAR_B) {
      board[from] -= player;
    } else {
      board[from] -= player * 1;
    }

    // Place checker at destination
    if (to === OFF_W || to === OFF_B) {
      board[to] += player;
    } else {
      // Check for hit (single opponent checker)
      if (board[to] * -player === 1) {
        // Send opponent to bar
        const opponentBar = player === 1 ? BAR_B : BAR_W;
        board[opponentBar] -= player;
        board[to] = 0;
      }
      board[to] += player;
    }

    // Calculate which die was used
    const dieUsed = Math.abs(
      (to === OFF_W || to === OFF_B)
        ? (player === 1 ? from + (POINTS + 1 - from) : from)
        : (player === 1 ? to - from : from - to)
    );

    // Mark die as used (first available matching die)
    for (let i = 0; i < this.dice.length; i++) {
      if (!this.diceUsed[i] && this.dice[i] === dieUsed) {
        this.diceUsed[i] = true;
        break;
      }
    }

    this.moveHistory.push({ from, to, die: dieUsed, player });

    // Check win
    this.checkWin(player);
  }

  // Execute multiple moves in sequence
  executeMoveSequence(moves) {
    for (const move of moves) {
      this.makeMove(move.from, move.to);
    }
    this.endTurn();
  }

  // Check for win
  checkWin(player) {
    const off = player === 1 ? this.board[OFF_W] : this.board[OFF_B];
    if (off >= 15) {
      this.gameOver = true;
      this.winner = player;
    }
  }

  // End turn and switch player
  endTurn() {
    this.dice = [];
    this.diceUsed = [];
    this.currentPlayer = -this.currentPlayer;
    this.doubleOffered = false;
  }

  // Get a simple text representation of the board
  boardToString() {
    const b = this.board;
    let s = 'Нарды\n';
    s += '╔══════════════════════════════════╗\n';
    s += '║ 12 11 10  9  8  7  6  5  4  3  2  1 ║\n';
    s += '║──────────────────────────────────║\n';
    // Top row (black home)
    for (let p = 12; p >= 1; p--) {
      const c = b[p];
      if (c === 0) s += '  .';
      else if (c < 0) s += ` ${Math.abs(c)}`;
      else s += ` ${Math.abs(c)}`;
    }
    s += '\n║                                  ║\n';
    for (let p = 13; p <= 24; p++) {
      const c = b[p];
      if (c === 0) s += '  .';
      else if (c < 0) s += ` ${Math.abs(c)}`;
      else s += ` ${Math.abs(c)}`;
    }
    s += '\n║ 13 14 15 16 17 18 19 20 21 22 23 24 ║\n';
    s += '╚══════════════════════════════════╝\n';
    s += `Бар: [${b[BAR_W]}:${b[BAR_B]}] Выброшено: [${b[OFF_W]}:${b[OFF_B]}]\n`;
    return s;
  }

  // Get state object for client
  getState() {
    return {
      board: [...this.board],
      currentPlayer: this.currentPlayer,
      dice: [...this.dice],
      diceUsed: [...this.diceUsed],
      gameOver: this.gameOver,
      winner: this.winner,
      doublingCube: this.doublingCube,
      doubleOffered: this.doubleOffered,
      doubleBy: this.doubleBy
    };
  }

  // Load state from server
  loadState(state) {
    this.board = [...state.board];
    this.currentPlayer = state.currentPlayer;
    this.dice = [...state.dice];
    this.diceUsed = [...state.diceUsed];
    this.gameOver = state.gameOver;
    this.winner = state.winner;
    this.doublingCube = state.doublingCube;
    this.doubleOffered = state.doubleOffered;
    this.doubleBy = state.doubleBy;
  }
}

module.exports = { Backgammon };
