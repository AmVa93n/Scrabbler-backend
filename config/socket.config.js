const http = require('http');
const socketIo = require('socket.io');
const app = require('../app');

const server = http.createServer(app);
const io = socketIo(server);

const Message = require('../models/Message.model'); 
const Room = require('../models/Room.model'); 
//const Chat = require('../models/Chat.model');
const User = require('../models/User.model');
//const Notification = require("../models/Notification.model");
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
        
        const roomSocketIds = io.sockets.adapter.rooms.get(roomId);
        const allSockets = io.sockets.sockets
        const waitingUsers = Array.from(roomSocketIds).map(id => allSockets.get(id).user)
        const session = activeGames.find(game => game.roomId === roomId)
        if (session) {
          const sessionData = {
            turnPlayer: session.players[session.turnPlayerIndex],
            turnEndTime: session.turnEndTime.toISOString(),
            turnNumber: session.turnNumber,
            inactivePlayerIds: [...session.inactivePlayerIds],
          }
          io.to(roomId).emit('refreshRoom', waitingUsers, sessionData);
        } else {
          io.to(roomId).emit('refreshRoom', waitingUsers);
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
      let game = activeGames.find(game => game.roomId === roomId)
      if (!game) {
        game = new GameSession(room)
        activeGames.push(game)
        game.sendMessage(`a new game started`)
        game.startTurn()
      }
      io.to(roomId).emit('roomUpdated', room);
    });

    socket.on('endGame', async (roomId) => {
      const room = await Room.findByIdAndUpdate(roomId, { gameSession: null }, { new: true })
      await room.populate('gameSession.players')
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        game.endGame()
        game.sendMessage(`The host has ended the game`)
      }
      io.to(roomId).emit('roomUpdated', room);
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
const turnDuration = 10 // for testing

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
        io.to(this.roomId).emit('turnTimeout', turnPlayer);
        // increase inactivity counters
        if (typeof turnPlayer.inactiveTurns !== 'number') turnPlayer.inactiveTurns = 0;
        turnPlayer.inactiveTurns += 1
        this.sendMessage(`${turnPlayer.name}'s turn has timed out (${turnPlayer.inactiveTurns})`)
        // end the game if 3 rounds passed with no moves made
        this.inactivityCounter += 1
        if (this.inactivityCounter > this.players.length * 3) {
          this.endGame()
          this.sendMessage(`Game ended due to inactivity of all players`)
          return
        }
        if (turnPlayer.inactiveTurns === 1) {
          this.inactivePlayerIds.push(turnPlayer._id)
          this.sendMessage(`${turnPlayer.name} missed 3 turns in a row and may be skipped`)
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

    endGame() {
      this.isActive = false;
      clearTimeout(this.turnTimeout); // Stop the current turn timer
      activeGames.splice(activeGames.indexOf(this), 1)
  }
}

module.exports = { server };