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
        console.log(`${socket.user.name} joined room ${roomId}`);
        
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
          io.to(roomId).emit('initRoomState', waitingUsers, sessionData);
        } else {
          io.to(roomId).emit('initRoomState', waitingUsers);
        }
        
    });

    socket.on('leaveRoom', (roomId) => {
        socket.roomId = null
        socket.leave(roomId);
        io.to(roomId).emit('userLeft', playerId);
        console.log(`${socket.user.name} left room ${roomId}`);
    });

    socket.on('kickPlayer', (roomId, playerId) => {
        io.to(roomId).emit('playerKicked', playerId);
        console.log(`Player with ID ${playerId} was kicked from room ${roomId}`);
    });

    socket.on('updateRoom', (roomId, updatedRoom) => {
        io.to(roomId).emit('roomUpdated', updatedRoom);
        console.log(updatedRoom.gameSession ? `a game started in room ${roomId}` : `a game ended in room ${roomId}`);
        const game = activeGames.find(game => game.roomId === roomId)
        if (updatedRoom.gameSession) {
            if (!game) activeGames.push(new GameSession(updatedRoom))
        } else {
            if (game) {
              game.endGame()
              activeGames.splice(activeGames.indexOf(game), 1)
            }
            const roomSocketIds = io.sockets.adapter.rooms.get(roomId);
            const allSockets = io.sockets.sockets
            const waitingUsers = Array.from(roomSocketIds).map(id => allSockets.get(id).user)
            io.to(roomId).emit('initRoomState', waitingUsers);
        }
    });

    socket.on('makeMove', (roomId, moveData) => {
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
        await room.populate('gameSession.players')
        await room.populate({
          path: 'messages',
          populate: {
            path: 'sender',
            select: 'name profilePic',
          }
        });
        io.to(roomId).emit('roomUpdated', room);
      } catch (err) {
        console.error(err);
      }

    });

    /*
    socket.on('getChats', async (userId) => {
      try {
        const Chats = await Chat.find({ participants: { $in: [userId] } })
        .populate({path: 'messages', options: { sort: { timestamp: 1 } }})
        .populate({path: 'participants', select: 'username profilePic'})
        .sort({ lastMessageTimestamp: -1 }).lean().exec();
        socket.emit('initChats', Chats);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('join chat', async (chatId) => {
      socket.join(chatId);
      console.log(`${socket.userId} joined chat ${chatId}`);
    });

    socket.on('private message', async (msg) => {
      const chat = await Chat.findById(msg.chatId)
      const newMessage = new Message({
        sender: msg.sender,
        recipient: msg.recipient,
        message: msg.message,
      });

      try {
        await newMessage.save();
        chat.messages.push(newMessage._id);
        chat.lastMessageTimestamp = newMessage.timestamp;
        await chat.save();
        io.to(msg.chatId).emit('private message', newMessage); // Emit to chat's room
        
        try {
          const rooms = io.sockets.adapter.rooms
          const room = rooms.get(msg.chatId)
          if (room.size === 1) {
            const existingNotif = await Notification.findOne({ source: msg.sender, target: msg.recipient, type: 'message', read: false }) // anti spam
            if (!existingNotif) {
              const notif = await Notification.create({ source: msg.sender, target: msg.recipient, type: 'message' })
              await notif.populate('source')
              const notifObject = notif.toObject();
              notifObject.timeDiff = formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })
              io.to(msg.recipient).emit('notification', notifObject)
            }
          }
        } catch (error) {
          console.error('Error accessing rooms:', error);
        }

      } catch (err) {
        console.error(err);
      }
    });
    */

    socket.on('disconnect', () => {
        if (!socket.user) return
        if (socket.roomId) io.to(socket.roomId).emit('userLeft', socket.user);
        console.log(`${socket.user.name} is offline`)
    });

});

const activeGames = []
const turnDuration = 60 // for testing

class GameSession {
    constructor(room) {
        this.roomId = room._id
        this.players = [...room.gameSession.players]
        this.turnPlayerIndex = 0;
        this.turnNumber = 1
        this.turnDuration = (turnDuration || 60) * 1000 // 60s by default
        this.inactivityCounter = 0
        this.inactivePlayerIds = []
        this.isActive = true;
        this.startTurn()
    }

    startTurn() {
        if (!this.isActive) return;  // Prevent turn logic if game is inactive
        const turnPlayer = this.players[this.turnPlayerIndex];
        if (turnPlayer.skipped) { // skip the turn if host marked player as inactive
          console.log(`${turnPlayer.name}'s turn was skipped due to inactivity`)
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
        console.log(`${turnPlayer.name}'s turn has started (turn #${this.turnNumber})`)
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
        console.log(`${turnPlayer.name} has made their move`)
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
        console.log(`${turnPlayer.name}'s turn has timed out (${turnPlayer.inactiveTurns})`)
        // end the game if 3 rounds passed with no moves made
        this.inactivityCounter += 1
        if (this.inactivityCounter > this.players.length * 3) {
          this.endGame()
          console.log(`Game ended due to inactivity of all players`)
          return
        }
        if (turnPlayer.inactiveTurns === 3) {
          this.inactivePlayerIds.push(turnPlayer._id)
          console.log(`${turnPlayer.name} missed 3 turns in a row and is eligible to be skipped`)
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
  }
}

module.exports = { server };