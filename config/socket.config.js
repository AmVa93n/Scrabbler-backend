const http = require('http');
const socketIo = require('socket.io');
const app = require('../app');

const server = http.createServer(app);
const io = socketIo(server);

const Message = null //require('../models/Message.model'); 
const Chat = null //require('../models/Chat.model');
const User = require('../models/User.model');
const Notification = null //require("../models/Notification.model");
//const { formatDistanceToNow } = require('date-fns');

io.on('connection', (socket) => {

    socket.on('online', async (user) => {
        socket.user = user
        socket.join(user._id);
        console.log(`${user.name} is online in roomId ${user._id}`)
    });

    socket.on('joinRoom', (roomId) => {
        if (!socket.user) return
        socket.roomId = roomId
        socket.join(roomId);
        io.to(roomId).emit('userJoined', socket.user);
        console.log(`${socket.user.name} joined room ${roomId}`);
        // Emit the current users in the room
        const roomSocketIds = io.sockets.adapter.rooms.get(roomId);
        const allSockets = io.sockets.sockets
        const currentUsers = Array.from(roomSocketIds).map(id => allSockets.get(id).user)
        io.to(roomId).emit('currentUsers', currentUsers);
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
        console.log(updatedRoom.isActive ? `a game started in room ${roomId}` : `a game ended in room ${roomId}`);
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

module.exports = { server };