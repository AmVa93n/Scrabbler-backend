const http = require('http');
const socketIo = require('socket.io');
const app = require('../app');

const server = http.createServer(app);
const io = socketIo(server);

const Message = require('../models/Message.model'); 
const Room = require('../models/Room.model'); 
//const { formatDistanceToNow } = require('date-fns');

io.on('connection', (socket) => {

    socket.on('online', async (user) => {
        socket.user = user
        socket.join(user._id);
        console.log(`${user.name} is online`)
    });

    socket.on('joinRoom', (roomId) => {
        if (!socket.user) return
        socket.roomId = roomId
        socket.join(roomId);
        io.to(roomId).emit('userJoined', socket.user);
        RoomManager.sendMessage(roomId, `${socket.user.name} joined the room`);
        
        const game = activeGames.find(game => game.roomId === roomId)
        if (game) {
          const sessionData = game.getRefreshData(socket.user._id)
          io.to(socket.user._id).emit('refreshGame', sessionData);

        } else {
          const roomSocketIds = io.sockets.adapter.rooms.get(roomId);
          const allSockets = io.sockets.sockets
          const usersInRoom = Array.from(roomSocketIds).map(id => allSockets.get(id).user)
          io.to(socket.user._id).emit('refreshRoom', usersInRoom);
        }
    });

    socket.on('leaveRoom', (leftOrKicked) => {
        if (!socket.roomId) return
        socket.leave(socket.roomId);
        io.to(socket.roomId).emit('userLeft', socket.user);
        const message = leftOrKicked === 'left' ? `${socket.user.name} left the room` : `The host kicked ${socket.user.name} from the room`
        RoomManager.sendMessage(socket.roomId, message);
        socket.roomId = null
    });

    socket.on('kickUser', async (roomId, user) => {
      const room = await Room.findById(roomId)
      room.kickedUsers.push(user._id);
      await room.save();
      io.to(user._id).emit('userKicked');
    });

    socket.on('startGame', async (roomId, hostId, gameSession) => {
      await Room.findByIdAndUpdate(roomId, { gameSession: gameSession })
      let game = activeGames.find(game => game.roomId === roomId)
      if (!game) {
        game = new GameSession(roomId, hostId, gameSession.players)
        game.startGame()
      }
    });

    socket.on('endGame', async (roomId) => {
      await Room.findByIdAndUpdate(roomId, { gameSession: null })
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        game.endGame()
        game.sendMessage(`The host has ended the game`)
      }
    });

    socket.on('skipPlayer', (roomId, userId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        const player = game.players.find(player => player._id === userId)
        if (player) player.skipped = true
      }
    });

    socket.on('validateMove', async (roomId, moveData) => {
        const game = activeGames.find(game => game.roomId === roomId)
        if (game) game.validateMove(moveData);
    });

    socket.on('message', async (roomId, messageData) => {
      const room = await Room.findById(roomId)
      const { sender, text } = messageData

      try {
        const message = await Message.create({ sender, text });
        room.messages.push(message._id);
        await room.save();
        await message.populate('sender', 'name profilePic');
        io.to(roomId).emit('chatUpdated', message);
      } catch (err) {
        console.error(err);
      }

    });

    socket.on('disconnect', () => {
        if (!socket.user) return
        if (socket.roomId) io.to(socket.roomId).emit('userLeft', socket.user);
        console.log(`${socket.user.name} is offline`)
    });

});

class RoomManager {
  static async sendMessage(roomId, text) {
    const room = await Room.findById(roomId)

      try {
        const message = await Message.create({ text });
        room.messages.push(message._id);
        await room.save();
        await message.populate('sender', 'name profilePic');
        io.to(roomId).emit('chatUpdated', message);
      } catch (err) {
        console.error(err);
      }
  }
}

const activeGames = []
const turnsUntilSkip = 3
const turnDuration = 30
const letterDistribution = {
  '': 2, 'E': 12, 'A': 9, 'I': 9, 'O': 8,  'N': 6, 'R': 6, 'T': 6, 'L': 4, 'S': 4, 'U': 4, 'D': 4, 'G': 3, 
  'B': 2, 'C': 2, 'M': 2, 'P': 2, 'F': 2, 'H': 2, 'V': 2, 'W': 2, 'Y': 2, 'K': 1, 'J': 1, 'X': 1, 'Q': 1, 'Z': 1
}
const boardSize = 15
const cooldown = 5 * 1000 // time between turns

class GameSession {
    constructor(roomId, hostId, players) {
        this.roomId = roomId
        this.hostId = hostId
        this.players = players
        this.turnPlayerIndex = 0;
        this.turnNumber = 1
        this.turnDuration = (turnDuration || 60) * 1000 // 60s by default
        this.inactivityCounter = 0
        this.inactivePlayerIds = []
        this.isOnCooldown = true
        this.isActive = true;
    }

    async sendMessage(text) {
      const room = await Room.findById(this.roomId)

      try {
        const message = await Message.create({ text });
        room.messages.push(message._id);
        await room.save();
        await message.populate('sender', 'name profilePic');
        io.to(this.roomId).emit('chatUpdated', message);
      } catch (err) {
        console.error(err);
      }
    }

    createLetterBag() {
      const letterBag = []
      let id = 1
      for (let letter in letterDistribution) {
        const count = letterDistribution[letter]
        for (let i=0; i < count; i++) {
          letterBag.push({id, letter, placed: false})
          id ++
        }
      }

      // Fisher-Yates Shuffle
      for (let i = letterBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)) // Get a random index from 0 to i
        // Swap elements using a temporary variable
        const temp = letterBag[i];
        letterBag[i] = letterBag[j];
        letterBag[j] = temp;
      }

      return letterBag
    }
 
    createBoard() {
      return Array.from({ length: boardSize }, (_, row) =>
        Array.from({ length: boardSize }, (_, col) => ({
            x: col,
            y: row,
            occupied: false,
            content: null,
        }))
      )
    }

    startGame() {
      activeGames.push(this)
      this.letterBag = this.createLetterBag()
      this.board = this.createBoard()
      this.sendMessage(`a new game started`)

      for (let player of this.players) {
        this.distributeLetters(player, 7)
      }
      const sessionData = {
        board: JSON.parse(JSON.stringify(this.board)),
        leftInBag: this.letterBag.length,
      }
      io.to(this.roomId).emit('gameStarted', [...this.players]);
      io.to(this.roomId).emit('gameUpdated', sessionData);
      // Send each player's letterBank to them individually
      for (let player of this.players) {
        io.to(player._id).emit('letterBankUpdated', player.letterBank);
      }
      setTimeout(() => {this.startTurn()}, cooldown);
    }

    distributeLetters(player, amount) {
      if (!player.letterBank) player.letterBank = []
      for (let i=0; i < amount; i++) {
        if (this.letterBag.length === 0) {
          break; // Exit if no letters are left in the bag
        }
        player.letterBank.push(this.letterBag.pop())
      }
    }

    startTurn() {
        if (!this.isActive) return;  // Prevent turn logic if game is inactive
        this.isOnCooldown = false // officially enter turn
        const turnPlayer = this.players[this.turnPlayerIndex];
        if (turnPlayer.skipped) { // skip the turn if host marked player as inactive
          this.sendMessage(`Turn ${this.turnNumber}: ${turnPlayer.name} was skipped due to inactivity`)
          this.nextTurn()
          return
        }
        this.turnEndTime = new Date(Date.now() + this.turnDuration); // x seconds from now
        // Clear the previous timeout (if any)
        if (this.turnTimeout) {
            clearTimeout(this.turnTimeout);
        }
        // Notify all players that it's the current player's turn
        const sessionData = {
          turnPlayer: turnPlayer,
          turnEndTime: this.turnEndTime.toISOString(),
          turnNumber: this.turnNumber,
        }
        io.to(this.roomId).emit('turnStarted', sessionData);
        this.sendMessage(`Turn ${this.turnNumber}: ${turnPlayer.name}'s turn has started`)
        // Set a timer
        this.turnTimeout = setTimeout(() => {
            this.handleTurnTimeout();
        }, this.turnDuration);
    }

    validateMove(moveData) {
      // if (isValid) etc...
      this.processMove(moveData)
    }

    processMove(moveData) {
        // Clear the timeout
        clearTimeout(this.turnTimeout);
        // ...
        const turnPlayer = this.players[this.turnPlayerIndex]
        this.sendMessage(`${turnPlayer.name} has made their move`)
        // reset inactivity counters
        this.inactivityCounter = 0
        turnPlayer.inactiveTurns = 0
        // Advance to the next player's turn after cooldown
        this.isOnCooldown = true
        io.to(this.roomId).emit('turnEnded');
        setTimeout(() => {this.nextTurn()}, cooldown);
    }

    async handleTurnTimeout() {
        if (!this.isActive) return;  // Skip if game is inactive
        const turnPlayer = this.players[this.turnPlayerIndex]
        io.to(turnPlayer._id).emit('turnTimedOut', turnPlayer.letterBank);
        // increase inactivity counters
        if (typeof turnPlayer.inactiveTurns !== 'number') turnPlayer.inactiveTurns = 0;
        turnPlayer.inactiveTurns += 1
        this.sendMessage(`${turnPlayer.name}'s turn has timed out (${turnPlayer.inactiveTurns})`)
        // end the game if 3 rounds passed with no moves made
        this.inactivityCounter += 1
        if (this.inactivityCounter > this.players.length * turnsUntilSkip) {
          await Room.findByIdAndUpdate(this.roomId, { gameSession: null })
          this.endGame()
          this.sendMessage(`Game ended due to inactivity of all players`)
          return
        }
        if (turnPlayer.inactiveTurns === turnsUntilSkip) {
          this.inactivePlayerIds.push(turnPlayer._id)
          io.to(this.hostId).emit('playerCanBeSkipped', this.inactivePlayerIds); // update the host
          this.sendMessage(`${turnPlayer.name} missed ${turnsUntilSkip} turns in a row and may be skipped`)
        }
        // Advance to the next player's turn without cooldown
        this.nextTurn();
    }
    
    nextTurn() {
        // Increment turn player index and turn number
        this.turnPlayerIndex = (this.turnPlayerIndex + 1) % this.players.length;
        this.turnNumber += 1
        // Start the next player's turn
        this.startTurn();
    }

    endGame() {
      this.isActive = false;
      clearTimeout(this.turnTimeout); // Stop the current turn timer
      activeGames.splice(activeGames.indexOf(this), 1)
      io.to(this.roomId).emit('gameEnded');
    }

    getRefreshData(userId) {
      // this info is not saved in the DB and needs to be resent to user if they refresh the page
      const sessionData = {
        turnPlayer: this.isOnCooldown ? null : this.players[this.turnPlayerIndex],
        turnEndTime: this.isOnCooldown ? null : this.turnEndTime.toISOString(),
        turnNumber: this.isOnCooldown ? null : this.turnNumber,
        board: JSON.parse(JSON.stringify(this.board)),
        leftInBag: this.letterBag.length,
        letterBank: this.players.find(player => player._id === userId).letterBank,
        inactivePlayerIds: [...this.inactivePlayerIds], // (only necessary for the host...)
      }
      return sessionData
    }
}

module.exports = { server };