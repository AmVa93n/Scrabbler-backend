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
        
        const session = activeGames.find(game => game.roomId === roomId)
        if (session) {
          const sessionData = {
            turnPlayer: session.players[session.turnPlayerIndex],
            turnEndTime: session.turnEndTime.toISOString(),
            turnNumber: session.turnNumber,
            inactivePlayerIds: [...session.inactivePlayerIds],
            board: JSON.parse(JSON.stringify(session.board)),
            leftInBag: session.letterBag.length,
            letterBank: session.players.find(player => player._id.toString() === socket.user._id).letterBank
          }
          io.to(socket.user._id).emit('refreshGame', sessionData);

        } else {
          const roomSocketIds = io.sockets.adapter.rooms.get(roomId);
          const allSockets = io.sockets.sockets
          const waitingUsers = Array.from(roomSocketIds).map(id => allSockets.get(id).user)
          io.to(socket.user._id).emit('refreshRoom', waitingUsers);
        }
        
    });

    socket.on('leaveRoom', (message) => {
        if (!socket.roomId) return
        socket.leave(socket.roomId);
        io.to(socket.roomId).emit('userLeft', socket.user);
        RoomManager.sendMessage(socket.roomId, message); // left or kicked
        socket.roomId = null
    });

    socket.on('kickUser', async (roomId, user) => {
      const room = await Room.findById(roomId)
      room.kickedUsers.push(user._id);
      await room.save();
      io.to(roomId).emit('roomUpdated', room);
    });

    socket.on('startGame', async (roomId, gameSession) => {
      const room = await Room.findByIdAndUpdate(roomId, { gameSession: gameSession }, { new: true })
      await room.populate('gameSession.players')
      io.to(roomId).emit('roomUpdated', room);
      let game = activeGames.find(game => game.roomId === roomId)
      if (!game) {
        game = new GameSession(room)
        game.startGame()
      }
    });

    socket.on('endGame', async (roomId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        game.endGame()
        game.sendMessage(`The host has ended the game`)
      } else {
        console.log('there is no active game in this room. Check the database')
      }
    });

    socket.on('skipPlayer', (roomId, userId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        const player = game.players.find(player => player._id.toString() === userId)
        if (player) player.skipped = true
      }
    });

    socket.on('makeMove', async (roomId, moveData) => {
        const game = activeGames.find(game => game.roomId === roomId)
        if (game) game.handleMove(moveData);
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

class GameSession {
    constructor(room) {
        this.roomId = room._id.toString()
        this.players = [...room.gameSession.players]
        this.turnPlayerIndex = 0;
        this.turnNumber = 1
        this.turnDuration = (turnDuration || 60) * 1000 // 60s by default
        this.inactivityCounter = 0
        this.inactivePlayerIds = []
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
      io.to(this.roomId).emit('gameUpdated', sessionData);
      // Send each player's letterBank to them individually
      for (let player of this.players) {
        const privateId = player._id.toString()
        io.to(privateId).emit('letterBankUpdated', player.letterBank);
      }
      this.startTurn()
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
        const turnPlayer = this.players[this.turnPlayerIndex];
        if (turnPlayer.skipped) { // skip the turn if host marked player as inactive
          this.sendMessage(`Turn ${this.turnNumber}: ${turnPlayer.name} was skipped due to inactivity`)
          this.nextTurn()
          return
        }
        this.turnEndTime = new Date(Date.now() + this.turnDuration); // 1 minute from now
        // Clear the previous timeout (if any)
        if (this.turnTimeout) {
            clearTimeout(this.turnTimeout);
        }
        // Notify all players that it's the current player's turn
        const sessionData = {
          turnPlayer: turnPlayer,
          turnEndTime: this.turnEndTime.toISOString(),
          turnNumber: this.turnNumber,
          inactivePlayerIds: [...this.inactivePlayerIds],
        }
        io.to(this.roomId).emit('turnStart', sessionData);
        this.sendMessage(`Turn ${this.turnNumber}: ${turnPlayer.name}'s turn has started`)
        // Set a 1-minute timer
        this.turnTimeout = setTimeout(() => {
            this.handleTurnTimeout();
        }, this.turnDuration);
    }

    handleMove(moveData) {
        // Clear the timeout
        clearTimeout(this.turnTimeout);
        // ...
        const turnPlayer = this.players[this.turnPlayerIndex]
        this.sendMessage(`${turnPlayer.name} has made their move`)
        // reset inactivity counters
        this.inactivityCounter = 0
        turnPlayer.inactiveTurns = 0
        // Advance to the next player's turn
        this.nextTurn();
    }

    handleTurnTimeout() {
        if (!this.isActive) return;  // Skip if game is inactive
        const turnPlayer = this.players[this.turnPlayerIndex]
        io.to(turnPlayer._id.toString()).emit('turnTimeout');
        // increase inactivity counters
        if (typeof turnPlayer.inactiveTurns !== 'number') turnPlayer.inactiveTurns = 0;
        turnPlayer.inactiveTurns += 1
        this.sendMessage(`${turnPlayer.name}'s turn has timed out (${turnPlayer.inactiveTurns})`)
        // end the game if 3 rounds passed with no moves made
        this.inactivityCounter += 1
        if (this.inactivityCounter > this.players.length * turnsUntilSkip) {
          this.endGame()
          this.sendMessage(`Game ended due to inactivity of all players`)
          return
        }
        if (turnPlayer.inactiveTurns === turnsUntilSkip) {
          this.inactivePlayerIds.push(turnPlayer._id)
          this.sendMessage(`${turnPlayer.name} missed ${turnsUntilSkip} turns in a row and may be skipped`)
        }
        // Advance to the next player's turn
        this.nextTurn();
    }
    
    nextTurn() {
        // Increment turn player index and turn number
        this.turnPlayerIndex = (this.turnPlayerIndex + 1) % this.players.length;
        this.turnNumber += 1
        // Start the next player's turn
        this.startTurn();
    }

    async endGame() {
      const room = await Room.findByIdAndUpdate(this.roomId, { gameSession: null }, { new: true })
      this.isActive = false;
      clearTimeout(this.turnTimeout); // Stop the current turn timer
      activeGames.splice(activeGames.indexOf(this), 1)
      io.to(this.roomId).emit('roomUpdated', room);
  }
}

module.exports = { server };