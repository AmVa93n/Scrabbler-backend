const http = require('http');
const socketIo = require('socket.io');
const app = require('../app');

const server = http.createServer(app);
const io = socketIo(server);

const Message = require('../models/Message.model'); 
const Room = require('../models/Room.model'); 
const Board = require('../models/Board.model'); 
//const { formatDistanceToNow } = require('date-fns');
const natural = require('natural');
const wordnet = new natural.WordNet(); // Load WordNet data

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
        RoomManager.sendMessage(roomId, `${socket.user.name} joined the room 👋`);
        
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
        const message = leftOrKicked === 'left' ? `${socket.user.name} left the room 😢` : `The host kicked ${socket.user.name} from the room 🚫`
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
        const boardData = await Board.findById('66e23df8c97b88528c8dfe04')
        game = new GameSession(roomId, hostId, gameSession.players, boardData, {})
        game.startGame()
      }
    });

    socket.on('endGame', async (roomId) => {
      await Room.findByIdAndUpdate(roomId, { gameSession: null })
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        game.endGame()
        game.sendMessage(`The host has ended the game ⛔`, `Game Over`)
      }
    });

    socket.on('skipPlayer', (roomId, userId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        const player = game.players.find(player => player._id === userId)
        if (player) player.skipped = true
      }
    });

    socket.on('validateMove', async (roomId, newlyPlacedLetters, updatedBoard) => {
        const game = activeGames.find(game => game.roomId === roomId)
        if (game) game.validateMove(newlyPlacedLetters, updatedBoard);
    });

    socket.on('replaceLetters', async (roomId, lettersToReplace) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) game.replaceLetters(lettersToReplace);
    });

    socket.on('passTurn', async (roomId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) game.passTurn();
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
  static async sendMessage(roomId, text, title) {
    const room = await Room.findById(roomId)

      try {
        const message = await Message.create({ title, text, minor: !title });
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
const defaultDistribution = {
  '': 2, 'E': 12, 'A': 9, 'I': 9, 'O': 8,  'N': 6, 'R': 6, 'T': 6, 'L': 4, 'S': 4, 'U': 4, 'D': 4, 'G': 3, 
  'B': 2, 'C': 2, 'M': 2, 'P': 2, 'F': 2, 'H': 2, 'V': 2, 'W': 2, 'Y': 2, 'K': 1, 'J': 1, 'X': 1, 'Q': 1, 'Z': 1
}

class GameSession {
    constructor(roomId, hostId, players, boardData, ruleset) {
        const { letterDistribution, turnDuration, turnsUntilSkip } = ruleset
        this.roomId = roomId
        this.hostId = hostId
        this.players = players
        this.turnPlayerIndex = 0;
        this.turnNumber = 1
        this.turnDuration = (turnDuration || 60) * 1000 
        this.turnsUntilSkip = (turnsUntilSkip || 3)
        this.cooldown = 3 * 1000 // time between turns
        this.inactivePlayerIds = []
        this.passedTurns = 0
        this.bankSize = 7
        this.isOnCooldown = true
        this.letterBag = this.createLetterBag((letterDistribution || defaultDistribution))
        this.board = this.createBoard(boardData)
        this.isActive = true;
    }

    async sendMessage(text, title) {
      const room = await Room.findById(this.roomId)

      try {
        const message = await Message.create({ title, text, minor: !title });
        room.messages.push(message._id);
        await room.save();
        await message.populate('sender', 'name profilePic');
        io.to(this.roomId).emit('chatUpdated', message);
      } catch (err) {
        console.error(err);
      }
    }

    createLetterBag(letterDistribution) {
      const letterBag = []
      let id = 1
      for (let letter in letterDistribution) {
        const count = letterDistribution[letter]
        for (let i=0; i < count; i++) {
          letterBag.push({id, letter, isBlank: letter === ''})
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

      //return letterBag
      return letterBag.slice(0, 17)
    }
 
    createBoard(boardData) {
      const { size, bonusTiles } = boardData
      return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, col) => ({
            x: col,
            y: row,
            occupied: false,
            content: null,
            bonusType: bonusTiles.find(bonusTile => bonusTile.x === col && bonusTile.y === row)?.bonusType
        }))
      )
    }

    startGame() {
      activeGames.push(this)
      this.sendMessage(`The host has started a new game 🎲`, `New Game`)

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
      setTimeout(() => {this.startTurn()}, this.cooldown);
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
          this.sendMessage(`${turnPlayer.name} was skipped due to inactivity ❌`, `Turn ${this.turnNumber}`)
          this.nextTurn()
          return
        }
        if (turnPlayer.letterBank.length === 0) { // skip the turn if player is out of letters
          this.sendMessage(`${turnPlayer.name} was skipped because they ran out of letters ❌`, `Turn ${this.turnNumber}`)
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
        this.sendMessage(`It is ${turnPlayer.name}'s turn ▶️`, `Turn ${this.turnNumber}`)
        // Set a timer
        this.turnTimeout = setTimeout(() => {
            this.handleTurnTimeout();
        }, this.turnDuration);
    }

    async validateMove(newlyPlacedLetters, updatedBoard) {
      const words = this.extractWordsFromBoard(newlyPlacedLetters, updatedBoard);
      
      // Convert wordnet.lookup to return a promise
      function isWordValid(word) {
        return new Promise((resolve) => {
            wordnet.lookup(word.toLowerCase(), (results) => {
                resolve(results.length > 0); // Resolve true if the word is valid, false otherwise
            });
        });
      };

      // Await the results of all word checks
      const validationResults = await Promise.all(
          words.map(word => isWordValid(word))
      );

      // Check if all words are valid
      const allWordsValid = validationResults.every(result => result);
      const turnPlayer = this.players[this.turnPlayerIndex]

      if (allWordsValid) {
        // All words are valid
        this.updateGame(newlyPlacedLetters, updatedBoard)
        const wordStr = words.length === 1 ? 'word' : 'words'
        this.sendMessage(`${turnPlayer.name} created ${words.length} ${wordStr}: ${words.join(', ')} 💡`, `Turn ${this.turnNumber}`)
        this.completeTurn()
      } else {
        // Some words are invalid
        io.to(turnPlayer._id).emit('moveRejected');
      }
    }

    extractWordsFromBoard(newlyPlacedLetters, updatedBoard) {
      const words = [];
    
      // Helper function to check if a word contains a new letter
      function letterPlacedThisTurn(tileSeq) {
        const newlyPlacedLetterIds = newlyPlacedLetters.map(letter => letter.id)
        return tileSeq.some(tile => tile.content && newlyPlacedLetterIds.includes(tile.content.id));
      }
    
      // Horizontal words
      for (let row = 0; row < updatedBoard.length; row++) {
        let tileSeq = [];
        for (let col = 0; col < updatedBoard[row].length; col++) {
          const tile = updatedBoard[row][col];
          if (tile.content) {
            tileSeq.push(tile); // Collect the tiles that form a word
          } else {
            if (tileSeq.length > 1 && letterPlacedThisTurn(tileSeq)) {
              words.push(tileSeq.map(tile => tile.content.letter).join('')); // Add valid word
            }
            tileSeq = []; // Reset
          }
        }
        if (tileSeq.length > 1 && letterPlacedThisTurn(tileSeq)) {
          words.push(tileSeq.map(tile => tile.content.letter).join('')); // Add valid word
        }
      }
    
      // Vertical words
      for (let col = 0; col < updatedBoard[0].length; col++) {
        let tileSeq = [];
        for (let row = 0; row < updatedBoard.length; row++) {
          const tile = updatedBoard[row][col];
          if (tile.content) {
            tileSeq.push(tile); // Collect the tiles that form a word
          } else {
            if (tileSeq.length > 1 && letterPlacedThisTurn(tileSeq)) {
              words.push(tileSeq.map(tile => tile.content.letter).join('')); // Add valid word
            }
            tileSeq = []; // Reset
          }
        }
        if (tileSeq.length > 1 && letterPlacedThisTurn(tileSeq)) {
          words.push(tileSeq.map(tile => tile.content.letter).join('')); // Add valid word
        }
      }
    
      return words;
    }

    updateGame(newlyPlacedLetters, updatedBoard) {
      const turnPlayer = this.players[this.turnPlayerIndex]
      // remove the placed letters from the player's bank and give them the same amount of new letters
      for (let placedLetter of newlyPlacedLetters) {
        const letterToRemove = turnPlayer.letterBank.find(letter => letter.id === placedLetter.id)
        const letterIndex = turnPlayer.letterBank.indexOf(letterToRemove)
        turnPlayer.letterBank.splice(letterIndex, 1)
      }
      const NewLettersNeeded = this.bankSize - turnPlayer.letterBank.length
      this.distributeLetters(turnPlayer, NewLettersNeeded)
      // save the updated board on the server side
      const newlyPlacedLetterIds = newlyPlacedLetters.map(letter => letter.id)
      for (let row of updatedBoard) {
        for (let tile of row) {
          if (tile.content) {
            if (newlyPlacedLetterIds.includes(tile.content.id)) {
              tile.fixed = true; // set the tile to fixed so the letter on it can't be moved anymore
            }
          }
        }
      }
      this.board = updatedBoard
      // update data for players on client side
      const sessionData = {
        board: JSON.parse(JSON.stringify(updatedBoard)),
        leftInBag: this.letterBag.length,
      }
      io.to(this.roomId).emit('gameUpdated', sessionData);
      io.to(turnPlayer._id).emit('letterBankUpdated', turnPlayer.letterBank);
    }

    replaceLetters(replacedLetterIds) {
      // remove letters from player's bank
      const turnPlayer = this.players[this.turnPlayerIndex]
      const lettersToReplace = []
      for (let id of replacedLetterIds) {
        const letterToRemove = turnPlayer.letterBank.find(letter => letter.id === id)
        const letterIndex = turnPlayer.letterBank.indexOf(letterToRemove)
        turnPlayer.letterBank.splice(letterIndex, 1)
        lettersToReplace.push(letterToRemove)
      }
      // add letters back to the bottom of the bag and distribute new letters
      this.letterBag.unshift(...lettersToReplace)
      this.distributeLetters(turnPlayer, lettersToReplace.length)
      io.to(turnPlayer._id).emit('turnPassed', turnPlayer.letterBank, JSON.parse(JSON.stringify(this.board)));
      this.sendMessage(`${turnPlayer.name} passed and replaced ${lettersToReplace.length} letters 🔄`, `Turn ${this.turnNumber}`)
      this.completeTurn()
    }

    passTurn() {
      io.to(turnPlayer._id).emit('turnPassed', turnPlayer.letterBank, JSON.parse(JSON.stringify(this.board)));
      this.sendMessage(`${turnPlayer.name} passed`, `Turn ${this.turnNumber}`)
      this.completeTurn(true)
    }

    async completeTurn(isPassed) {
      // Clear the timeout
      clearTimeout(this.turnTimeout);
      // reset inactivity counters
      const turnPlayer = this.players[this.turnPlayerIndex]
      turnPlayer.inactiveTurns = 0
      // if turn was passed without replacing any letters
      if (isPassed) { this.passedTurns += 1 } else { this.passedTurns = 0}
      if (this.passedTurns === this.players.length) { // no player can make any more words
        await Room.findByIdAndUpdate(this.roomId, { gameSession: null })
        this.endGame()
        this.sendMessage(`No player is able to create more words. the winner is ${this.players[0]} 🏆`, `Game Over`)
        return
      }
      // Advance to the next player's turn after cooldown
      this.isOnCooldown = true
      io.to(this.roomId).emit('turnEnded');
      setTimeout(() => {this.nextTurn()}, this.cooldown);
    }

    async handleTurnTimeout() {
        if (!this.isActive) return;  // Skip if game is inactive
        const turnPlayer = this.players[this.turnPlayerIndex]
        io.to(turnPlayer._id).emit('turnTimedOut', turnPlayer.letterBank, JSON.parse(JSON.stringify(this.board)));
        this.sendMessage(`${turnPlayer.name}'s turn has timed out! ⌛`, `Turn ${this.turnNumber}`)
        
        // increase inactivity counter
        if (typeof turnPlayer.inactiveTurns !== 'number') turnPlayer.inactiveTurns = 0;
        turnPlayer.inactiveTurns += 1
        if (turnPlayer.inactiveTurns === this.turnsUntilSkip) {
          this.inactivePlayerIds.push(turnPlayer._id)
          io.to(this.hostId).emit('playerCanBeSkipped', this.inactivePlayerIds); // update the host
          this.sendMessage(`${turnPlayer.name} missed ${this.turnsUntilSkip} turns in a row and may be skipped ⚠️`)
        }

        // end the game if x rounds passed with no moves made by any player
        if (this.players.every(player => player.inactiveTurns >= this.turnsUntilSkip)) {
          await Room.findByIdAndUpdate(this.roomId, { gameSession: null })
          this.endGame()
          this.sendMessage(`The game ended due to inactivity of all players 😴`, `Game Over`)
          return
        }
        
        // Advance to the next player's turn after cooldown
        this.isOnCooldown = true
        io.to(this.roomId).emit('turnEnded');
        setTimeout(() => {this.nextTurn()}, this.cooldown);
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