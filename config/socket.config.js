const http = require('http');
const socketIo = require('socket.io');
const app = require('../app');

const server = http.createServer(app);
const io = socketIo(server);

const Message = require('../models/Message.model'); 
const Room = require('../models/Room.model'); 
const Game = require('../models/Game.model'); 
//const { formatDistanceToNow } = require('date-fns');
const natural = require('natural');
const wordnet = new natural.WordNet(); // Load WordNet data
const axios = require('axios');

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
      const { players, settings } = gameSession
      const newGame = await Game.create({roomId, hostId, players, settings})
      await Room.findByIdAndUpdate(roomId, { gameSession: newGame })
      let game = activeGames.find(game => game.roomId === roomId)
      if (!game) {
        game = new GameSession(newGame._id, roomId, hostId, players, settings)
        game.startGame()
      }
    });

    socket.on('endGame', async (roomId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        game.endGame()
        game.sendMessage(`The host has ended the game ⛔`, `Game Over`)
      } else { // fallback in case game lost from server memory
        RoomManager.endGame(roomId)
        RoomManager.sendMessage(roomId, `The host has ended the game ⛔`, `Game Over`)
      }
    });

    socket.on('skipPlayer', (roomId, userId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        const player = game.players.find(player => player._id === userId)
        if (player) player.skipped = true
      }
    });

    socket.on('validateMove', async (roomId, newlyPlacedLetters, updatedBoard, wordsWithScores, promptData) => {
        const game = activeGames.find(game => game.roomId === roomId)
        if (game) game.validateMove(newlyPlacedLetters, updatedBoard, wordsWithScores, promptData);
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

    socket.on('reaction', async (roomId, messageId, userId, reactionType) => {
      try {
        const message = await Message.findById(messageId);
        // Check if the user has already reacted with the same reaction
        const existingReaction = message.reactions.find(
          (reaction) => reaction.user.toString() === userId && reaction.type === reactionType
        );
        if (!existingReaction) {
          // Add the new reaction
          message.reactions.push({ user: userId, type: reactionType });
          await message.save();
          io.to(roomId).emit('reactionsUpdated', messageId, message.reactions);
        }
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

  static async endGame(roomId) {
    await Room.findByIdAndUpdate(roomId, { gameSession: null })
    io.to(roomId).emit('gameEnded');
  }
}

const activeGames = []

class GameSession {
    constructor(gameId, roomId, hostId, players, settings) {
        const { board, letterBag, turnDuration, turnsUntilSkip, bankSize } = settings
        this.gameId = gameId
        this.roomId = roomId
        this.hostId = hostId
        this.players = players
        this.turnPlayerIndex = 0;
        this.turnNumber = 1
        this.turnDuration = turnDuration * 1000 
        this.turnsUntilSkip = turnsUntilSkip
        this.bankSize = bankSize
        this.cooldown = 3 * 1000 // time between turns
        this.passedTurns = 0
        this.isOnCooldown = true
        this.letterBag = this.createLetterBag(letterBag)
        this.board = this.createBoard(board)
        this.isActive = true;
    }

    async sendMessage(text, title, genData) {
      const room = await Room.findById(this.roomId)

      try {
        const message = await Message.create({ title, text, minor: !title, 
                                                generated: genData?.generated, associatedWith: genData?.associatedWith});
        room.messages.push(message._id);
        await room.save();
        await message.populate('sender', 'name profilePic');
        io.to(this.roomId).emit('chatUpdated', message);
      } catch (err) {
        console.error(err);
      }
    }

    createLetterBag(letterBagData) {
      const letterBag = []
      let id = 1
      for (let { letter, count, points } of letterBagData.letterData) {
        for (let i = 0; i < count; i++) {
          letterBag.push({
            id,
            letter,
            isBlank: letter === '',
            points
          });
          id++;
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
      //return letterBag.slice(0, 17)
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
        this.distributeLetters(player, this.bankSize)
      }
      const sessionData = {
        board: JSON.parse(JSON.stringify(this.board)),
        leftInBag: this.letterBag.length,
        players: this.players,
      }
      io.to(this.roomId).emit('gameStarted');
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

    async validateMove(newlyPlacedLetters, updatedBoard, wordsWithScores, promptData) {
      const words = wordsWithScores.map(w => w.word)
      
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
        const wordStr = words.length === 1 ? 'word' : 'words'
        const wordScoreList = wordsWithScores.map(w => `${w.word} (${w.score} points)`).join('\n');
        const totalScore = wordsWithScores.reduce((sum, w) => sum + w.score, 0);
        this.updateGame(newlyPlacedLetters, updatedBoard, totalScore)
        this.sendMessage(
          `${turnPlayer.name} created ${words.length} ${wordStr} 💡\n${wordScoreList}\nTotal score: ${totalScore} points`,
          `Turn ${this.turnNumber}`
        );
        this.generateText(promptData)
        this.endTurn()
      } else {
        // Some words are invalid
        io.to(turnPlayer._id).emit('moveRejected');
      }
    }

    updateGame(newlyPlacedLetters, updatedBoard, turnScore) {
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
      // update player score
      if (typeof turnPlayer.score !== 'number') turnPlayer.score = 0;
      turnPlayer.score += turnScore
      // update data for players on client side
      const sessionData = {
        board: JSON.parse(JSON.stringify(updatedBoard)),
        leftInBag: this.letterBag.length,
        players: this.players
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
      this.endTurn()
    }

    passTurn() {
      const turnPlayer = this.players[this.turnPlayerIndex]
      io.to(turnPlayer._id).emit('turnPassed', turnPlayer.letterBank, JSON.parse(JSON.stringify(this.board)));
      this.sendMessage(`${turnPlayer.name} passed`, `Turn ${this.turnNumber}`)
      this.endTurn(true)
    }

    endTurn(isPassed) {
      // Clear the timeout
      clearTimeout(this.turnTimeout);
      // reset inactivity counters
      const turnPlayer = this.players[this.turnPlayerIndex]
      turnPlayer.inactiveTurns = 0
      // if turn was passed without replacing any letters
      if (isPassed) { this.passedTurns += 1 } else { this.passedTurns = 0}
      if (this.passedTurns === this.players.length) { // no player can make any more words
        this.endGame()
        this.sendMessage(`No player is able to create more words. the winner is ${this.players[0].name} 🏆`, `Game Over`)
        return
      }
      // Advance to the next player's turn after cooldown
      this.isOnCooldown = true
      io.to(this.roomId).emit('turnEnded');
      setTimeout(() => {this.nextTurn()}, this.cooldown);
    }

    handleTurnTimeout() {
        if (!this.isActive) return;  // Skip if game is inactive
        const turnPlayer = this.players[this.turnPlayerIndex]
        io.to(turnPlayer._id).emit('turnTimedOut', turnPlayer.letterBank, JSON.parse(JSON.stringify(this.board)));
        this.sendMessage(`${turnPlayer.name}'s turn has timed out! ⌛`, `Turn ${this.turnNumber}`)
        
        // increase inactivity counter
        if (typeof turnPlayer.inactiveTurns !== 'number') turnPlayer.inactiveTurns = 0;
        turnPlayer.inactiveTurns += 1
        if (turnPlayer.inactiveTurns === this.turnsUntilSkip) {
          turnPlayer.inactive = true
          io.to(this.hostId).emit('playerCanBeSkipped', this.players); // update the host
          this.sendMessage(`${turnPlayer.name} missed ${this.turnsUntilSkip} turns in a row and may be skipped ⚠️`)
        }

        // end the game if x rounds passed with no moves made by any player
        if (this.players.every(player => player.inactiveTurns >= this.turnsUntilSkip)) {
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

    async endGame() {
      this.isActive = false;
      clearTimeout(this.turnTimeout); // Stop the current turn timer
      activeGames.splice(activeGames.indexOf(this), 1)
      const state = {
        turnPlayerIndex: this.turnPlayerIndex,
        turnEndTime: this.turnEndTime,
        turnNumber: this.turnNumber,
        board: this.board,
        leftInBag: this.letterBag.length,
        passedTurns: this.passedTurns,
        isOnCooldown: this.isOnCooldown,
      }
      await Game.findOneAndUpdate(this.gameId,{ state })
      RoomManager.endGame(this.roomId)
    }

    getRefreshData(userId) {
      const player = this.players.find(player => player._id === userId)
      // this info is not saved in the DB and needs to be resent to user if they refresh the page
      const sessionData = {
        turnPlayer: this.isOnCooldown ? null : this.players[this.turnPlayerIndex],
        turnEndTime: this.isOnCooldown ? null : this.turnEndTime.toISOString(),
        turnNumber: this.isOnCooldown ? null : this.turnNumber,
        board: JSON.parse(JSON.stringify(this.board)),
        leftInBag: this.letterBag.length,
        letterBank: player?.letterBank,
        players: this.players, // because scores etc. are not saved in DB
      }
      return sessionData
    }

    async generateText(promptData) {
        if (!promptData) return
        const turnPlayer = this.players[this.turnPlayerIndex]
        const API_URL = 'https://api-inference.huggingface.co/models/gpt2';
        const API_KEY = process.env.HUGGING_FACE_API_KEY
        try {
          const response = await axios.post(API_URL, 
            { 
              inputs: promptData.promptText, 
              parameters: { 
                max_new_tokens: 50,
                temperature: 0.7,
                top_p: 0.9,
                //frequency_penalty: 0.1,
                //repetition_penalty: 1.03,
              } },
            { headers: { Authorization: `Bearer ${API_KEY}` } }
          );
          
          let generatedText = response.data[0]?.generated_text || response.data[0]?.text || '';
          // Split the response into sentences using a more reliable method
          const sentences = generatedText.split(/(?<=[.!?])(?:\s+"|\s+|\s*)/); // Split by punctuation followed by a space
          // if output is longer than 25 characters or the second sentence doesn't end in a dot, get only 1 sentence
          const sentenceNum = generatedText.length > 25 || sentences[1][sentences[1].length-1] !== '.' ? 1 : 2
          if (sentences.length > sentenceNum) {
              generatedText = sentences.slice(0, sentenceNum).join(' ').trim(); // Limit to 2 sentences
          }
          this.sendMessage(generatedText, null, {generated: true, associatedWith: turnPlayer._id})
        } catch (error) {
          console.error('Error generating text:', error.message);
        }
    }
}

module.exports = { server };