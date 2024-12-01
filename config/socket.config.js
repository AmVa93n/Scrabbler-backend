const http = require('http');
const socketIo = require('socket.io');
const app = require('../app');

const server = http.createServer(app);
const io = socketIo(server);

const Message = require('../models/Message.model'); 
const Room = require('../models/Room.model'); 
const Game = require('../models/Game.model'); 
//const { formatDistanceToNow } = require('date-fns');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'sowpods.txt');
const data = fs.readFileSync(filePath, 'utf-8'); // Read the text file content
const dictionary = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);

io.on('connection', (socket) => {

    socket.on('online', async (user) => {
        socket.user = user
        socket.join(user._id);
        console.log(`${user.name} is online`)
    });

    socket.on('joinRoom', (roomId) => {
        if (!socket.user) return
        const userId = socket.user._id;
        const roomSocketIds = io.sockets.adapter.rooms.get(roomId);
        const allSockets = io.sockets.sockets;
        let usersInRoom = []
        if (roomSocketIds) usersInRoom = Array.from(roomSocketIds).map(id => allSockets.get(id).user);
        
        // Check if any of the existing sockets in the room belong to the same user
        const isUserAlreadyInRoom = usersInRoom.some(user => user._id === userId);
        if (!isUserAlreadyInRoom) {
          socket.roomId = roomId
          socket.join(roomId);
          io.to(roomId).emit('userJoined', socket.user);
          RoomManager.sendMessage(roomId, `${socket.user.name} joined the room 👋`);
        }

        const game = activeGames.find(game => game.roomId === roomId)
        if (game) {
          const sessionData = game.getRefreshData(socket.user._id)
          io.to(socket.user._id).emit('refreshGame', sessionData);
        } else {
          const userList = isUserAlreadyInRoom ? usersInRoom : [...usersInRoom, socket.user]
          io.to(socket.user._id).emit('refreshRoom', userList);
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
      const newGame = await Game.create({room: roomId, host: hostId, players, settings})
      await Room.findByIdAndUpdate(roomId, { gameSession: newGame })
      let game = activeGames.find(game => game.roomId === roomId)
      if (!game) {
        game = new GameSession(newGame._id.toString(), roomId, hostId, players, settings)
        game.startGame()
      }
    });

    socket.on('endGame', async (roomId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) game.endedByHost()
      RoomManager.endGame(roomId)
      RoomManager.sendMessage(roomId, `The host has ended the game ⛔`, `Game Over`)
    });

    socket.on('validateMove', async (roomId, newlyPlacedLetters, updatedBoard, wordsWithScores, promptData) => {
        const game = activeGames.find(game => game.roomId === roomId)
        if (game) game.handleMove(newlyPlacedLetters, updatedBoard, wordsWithScores, promptData);
    });

    socket.on('swapLetters', async (roomId, lettersToSwap) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) game.swapLetters(lettersToSwap);
    });

    socket.on('passTurn', async (roomId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) game.passTurn();
    });

    socket.on('playerIsBack', async (roomId, playerId) => {
      const game = activeGames.find(game => game.roomId === roomId)
      if (game) {
        const player = game.players.find(player => player._id === playerId)
        player.inactiveTurns = 0;
      }
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
        // Add the new reaction
        message.reactions.push({ user: userId, type: reactionType });
        await message.save();
        await message.populate('reactions.user', 'name')
        io.to(roomId).emit('reactionsUpdated', messageId, message.reactions);
        // update reaction score if reaction type matches the target reaction
        if (reactionType === message.targetReaction) {
          const game = activeGames.find(game => game.roomId === roomId && game.gameId === message.generatedFor.toString())
          if (game) game.updateReactionScore(message.generatedBy.toString());
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
        const { board, tileBag, turnDuration, turnsUntilSkip, rackSize, gameEnd } = settings
        this.gameId = gameId
        this.roomId = roomId
        this.hostId = hostId
        this.players = players
        this.turnPlayerIndex = 0;
        this.turnNumber = 1
        this.turnDuration = turnDuration * 1000 
        this.turnsUntilSkip = turnsUntilSkip
        this.rackSize = rackSize
        this.gameEnd = gameEnd
        this.cooldown = 3 * 1000 // time between turns
        this.passedTurns = 0
        this.isOnCooldown = true
        this.tileBag = this.createTileBag(tileBag)
        this.board = this.createBoard(board)
    }

    async sendMessage(text, title, genData) {
      const room = await Room.findById(this.roomId)
      const { generated, generatedBy, generatedFor, targetReaction} = genData || {}

      try {
        const message = await Message.create({ title, text, minor: !title, generated, generatedBy, generatedFor, targetReaction});
        room.messages.push(message._id);
        await room.save();
        await message.populate('sender', 'name profilePic');
        io.to(this.roomId).emit('chatUpdated', message);
      } catch (err) {
        console.error(err);
      }
    }

    createTileBag(tileBagData) {
      const tileBag = []
      let id = 1
      for (let { letter, count, points } of tileBagData.letterData) {
        for (let i = 0; i < count; i++) {
          tileBag.push({
            id,
            letter,
            isBlank: letter === '',
            points
          });
          id++;
        }
      }

      // Fisher-Yates Shuffle
      for (let i = tileBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)) // Get a random index from 0 to i
        // Swap elements using a temporary variable
        const temp = tileBag[i];
        tileBag[i] = tileBag[j];
        tileBag[j] = temp;
      }

      return tileBag
    }
 
    createBoard(boardData) {
      const { size, bonusSquares } = boardData
      return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, col) => ({
            x: col,
            y: row,
            occupied: false,
            content: null,
            bonusType: bonusSquares.find(square => square.x === col && square.y === row)?.bonusType
        }))
      )
    }

    startGame() {
      activeGames.push(this)
      this.sendMessage(`The host has started a new game 🎲`, `New Game`)

      for (let player of this.players) {
        player.rack = []
        this.distributeLetters(player, this.rackSize)
        player.score = 0
        player.inactiveTurns = 0
        player.reactionScore = 0
      }
      const sessionData = {
        board: JSON.parse(JSON.stringify(this.board)),
        leftInBag: this.tileBag.length,
        players: this.players,
      }
      io.to(this.roomId).emit('gameStarted', this.rackSize, this.gameEnd);
      io.to(this.roomId).emit('gameUpdated', sessionData);
      // Send each player's rack to them individually
      for (let player of this.players) {
        io.to(player._id).emit('rackUpdated', player.rack);
      }
      setTimeout(() => {this.startTurn()}, this.cooldown);
    }

    distributeLetters(player, amount) {
      for (let i=0; i < amount; i++) {
        if (this.tileBag.length === 0) {
          break; // Exit if no letters are left in the bag
        }
        player.rack.push(this.tileBag.pop())
      }
    }

    startTurn() {
        this.isOnCooldown = false // officially enter turn
        const turnPlayer = this.players[this.turnPlayerIndex];
        if (turnPlayer.inactiveTurns >= this.turnsUntilSkip) { // skip the turn if player is inactive
          this.sendMessage(`${turnPlayer.name}'s turn was skipped due to inactivity ❌`, `Turn ${this.turnNumber}`)
          this.endTurn()
          return
        }
        if (turnPlayer.rack.length === 0) { // auto pass the turn if player is out of tiles
          this.sendMessage(`${turnPlayer.name}'s turn was skipped because they ran out of tiles ❌`, `Turn ${this.turnNumber}`)
          this.endTurn(true)
          return
        }

        this.turnEndTime = new Date(Date.now() + this.turnDuration); // x seconds from now
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

    handleMove(usedTiles, updatedBoard, wordsWithScores, promptData) {
      const words = wordsWithScores.map(w => w.word)
      const turnPlayer = this.players[this.turnPlayerIndex]

      if (this.isMoveValid(words)) { // All words are valid
        const wordStr = words.length === 1 ? 'word' : 'words'
        const wordScoreList = wordsWithScores.map(w => `${w.word} (${w.score} points)`).join('\n');
        let totalScore = wordsWithScores.reduce((sum, w) => sum + w.score, 0);
        const bingo = usedTiles.length === this.rackSize
        if (bingo) totalScore += 50
        this.updateGame(usedTiles, updatedBoard, totalScore)
        this.sendMessage(
          `${turnPlayer.name} created ${words.length} ${wordStr} 💡\n${wordScoreList}
          ${bingo ? 'Bonus for using entire rack (50 points)\n' : ''}Total score: ${totalScore} points`,
          `Turn ${this.turnNumber}`
        );
        this.generateText(promptData)
        this.endTurn()
      } else { // Some words are invalid
        const invalidWords = words.filter(word => !dictionary.includes(word))
        io.to(turnPlayer._id).emit('moveRejected', invalidWords);
      }
    }

    isMoveValid(words) {
      return words.every(word => dictionary.includes(word))
    }

    updateGame(usedTiles, updatedBoard, turnScore) {
      const turnPlayer = this.players[this.turnPlayerIndex]
      // remove the placed letters from the player's rack and give them the same amount of new letters
      for (let usedTile of usedTiles) {
        const tileToRemove = turnPlayer.rack.find(tile => tile.id === usedTile.id)
        const tileIndex = turnPlayer.rack.indexOf(tileToRemove)
        turnPlayer.rack.splice(tileIndex, 1)
      }
      const newTilesNeeded = this.rackSize - turnPlayer.rack.length
      this.distributeLetters(turnPlayer, newTilesNeeded)
      // save the updated board on the server side
      const usedTileIds = usedTiles.map(tile => tile.id)
      for (let row of updatedBoard) {
        for (let square of row) {
          if (square.content) {
            if (usedTileIds.includes(square.content.id)) {
              square.fixed = true; // set the square to fixed so the tile on it can't be moved anymore
            }
          }
        }
      }
      this.board = updatedBoard
      // update player score
      turnPlayer.score += turnScore
      // update data for players on client side
      const sessionData = {
        board: JSON.parse(JSON.stringify(updatedBoard)),
        leftInBag: this.tileBag.length,
        players: this.players
      }
      io.to(this.roomId).emit('gameUpdated', sessionData);
      io.to(turnPlayer._id).emit('rackUpdated', turnPlayer.rack);
    }

    swapLetters(SwappedLetterIds) {
      // remove letters from player's rack
      const turnPlayer = this.players[this.turnPlayerIndex]
      const lettersToSwap = []
      for (let id of SwappedLetterIds) {
        const letterToRemove = turnPlayer.rack.find(letter => letter.id === id)
        const letterIndex = turnPlayer.rack.indexOf(letterToRemove)
        turnPlayer.rack.splice(letterIndex, 1)
        lettersToSwap.push(letterToRemove)
      }
      // add letters back to the bottom of the bag and distribute new letters
      this.tileBag.unshift(...lettersToSwap)
      this.distributeLetters(turnPlayer, lettersToSwap.length)
      io.to(turnPlayer._id).emit('rackUpdated', turnPlayer.rack);
      this.sendMessage(`${turnPlayer.name} passed and swapped ${lettersToSwap.length} letters 🔄`, `Turn ${this.turnNumber}`)
      this.endTurn()
    }

    passTurn() {
      const turnPlayer = this.players[this.turnPlayerIndex]
      this.sendMessage(`${turnPlayer.name} passed`, `Turn ${this.turnNumber}`)
      this.endTurn(true)
    }

    endTurn(isPassed) {
      // Clear the timeout
      clearTimeout(this.turnTimeout);
      // reset inactivity counters
      const turnPlayer = this.players[this.turnPlayerIndex]
      if (turnPlayer.inactiveTurns > 0 && turnPlayer.inactiveTurns < this.turnsUntilSkip) turnPlayer.inactiveTurns = 0

      // check for rack out
      if (this.gameEnd === 'classic' && turnPlayer.rack.length === 0) {
        this.handleRackOut()
        return
      }

      // if turn was passed without replacing any letters
      if (isPassed) { this.passedTurns += 1 } else { this.passedTurns = 0}
      const activePlayers = this.players.filter(player => player.inactiveTurns < this.turnsUntilSkip)
      if (this.passedTurns === activePlayers.length) { // no player can make any more words
        this.handleAllPlayersPass()
        return
      }

      // Advance to the next player's turn after cooldown
      this.isOnCooldown = true
      io.to(this.roomId).emit('turnEnded');
      setTimeout(() => {this.nextTurn()}, this.cooldown);
    }

    handleRackOut() {
      // penalize other players and add penalties to the player who racked out
      const turnPlayer = this.players[this.turnPlayerIndex]
      const otherPlayers = this.players.filter(player => player._id !== turnPlayer._id)
      for (let player of otherPlayers) {
        player.penalty = player.rack.reduce((penalty, tile) => penalty + tile.points, 0)
        player.score -= player.penalty
      }
      const totalPenalties = otherPlayers.reduce((total, player) => total + player.penalty, 0)
      turnPlayer.score += totalPenalties
      this.players.sort((a,b)=> b.score - a.score)

      // stop and save game
      activeGames.splice(activeGames.indexOf(this), 1)
      this.saveGame()

      // announce winner
      const penaltyList = otherPlayers.map(player => {
        const remainingTiles = player.rack.map(tile => tile.letter ? tile.letter : 'blank').join(', ')
        return `${player.name} had: ${remainingTiles} (-${player.penalty} points)`
      }).join('\n');
      this.sendMessage(`${turnPlayer.name}'s rack is empty!
        ${penaltyList}
        ${turnPlayer.name} received a total of ${totalPenalties} points
        The winner is ${this.players[0].name} with ${this.players[0].score} points 🏆`, `Game Over`)
      setTimeout(() => this.sendFinalScores(), 3000)
      RoomManager.endGame(this.roomId)
    }

    handleAllPlayersPass() {
      this.players.sort((a,b)=> b.score - a.score)
      activeGames.splice(activeGames.indexOf(this), 1)
      this.saveGame()
      this.sendMessage(`No player is able to create more words. 
        The winner is ${this.players[0].name} with ${this.players[0].score} points 🏆`, `Game Over`)
      setTimeout(() => this.sendFinalScores(), 3000)
      RoomManager.endGame(this.roomId)
    }

    sendFinalScores() {
      // Generate placements and format the final score list
      const scoreList = this.players.map((player, index) => {
        let placement;
        switch (index) {
          case 0: placement = '🥇 1st'; break
          case 1: placement = '🥈 2nd'; break
          case 2: placement = '🥉 3rd'; break
          default: placement = `${index + 1}th`; break;
        }
        return `${placement}: ${player.name} - ${player.score} points`;
      }).join('\n');
      this.sendMessage(scoreList, `Final Scores`)
    }

    handleTurnTimeout() {
        const turnPlayer = this.players[this.turnPlayerIndex]
        turnPlayer.inactiveTurns += 1
        const hasBecomeInactive = turnPlayer.inactiveTurns === this.turnsUntilSkip
        io.to(turnPlayer._id).emit('turnTimedOut', hasBecomeInactive);
        this.sendMessage(`${turnPlayer.name}'s turn has timed out! ⌛`, `Turn ${this.turnNumber}`)
        if (hasBecomeInactive) {
          this.sendMessage(`${turnPlayer.name} missed ${this.turnsUntilSkip} turns in a row and will be skipped from now on ⚠️`)
        }

        // end the game if x rounds passed with no moves made by any player
        if (this.players.every(player => player.inactiveTurns >= this.turnsUntilSkip)) {
          this.allPlayersInactive()
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

    async allPlayersInactive() {
      clearTimeout(this.turnTimeout);
      activeGames.splice(activeGames.indexOf(this), 1)
      await Game.findByIdAndDelete(this.gameId)
      RoomManager.endGame(this.roomId)
      this.sendMessage(`The game ended due to inactivity of all players 😴`, `Game Over`)
    }

    async endedByHost() {
      clearTimeout(this.turnTimeout);
      activeGames.splice(activeGames.indexOf(this), 1)
      await Game.findByIdAndDelete(this.gameId)
    }

    async saveGame() {
      const state = {
        turnPlayerIndex: this.turnPlayerIndex,
        turnEndTime: this.turnEndTime,
        turnNumber: this.turnNumber,
        board: this.board,
        leftInBag: this.tileBag.length,
        passedTurns: this.passedTurns,
        isOnCooldown: this.isOnCooldown,
      }
      await Game.findByIdAndUpdate(this.gameId,{ state, players: this.players })
    }

    getRefreshData(userId) {
      const player = this.players.find(player => player._id === userId)
      // this info is not saved in the DB and needs to be resent to user if they refresh the page
      const sessionData = {
        turnPlayer: this.isOnCooldown ? null : this.players[this.turnPlayerIndex],
        turnEndTime: this.isOnCooldown ? null : this.turnEndTime.toISOString(),
        turnNumber: this.isOnCooldown ? null : this.turnNumber,
        board: JSON.parse(JSON.stringify(this.board)),
        leftInBag: this.tileBag.length,
        rack: player?.rack,
        reactionScore: player?.reactionScore,
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
          this.sendMessage(generatedText, null, 
            {generated: true, generatedBy: turnPlayer._id, generatedFor: this.gameId, targetReaction: promptData.targetReaction})
        } catch (error) {
          console.error('Error generating text:', error.message);
        }
    }

    updateReactionScore(playerId) {
      const player = this.players.find(player => player._id === playerId)
      player.reactionScore += 1
      io.to(playerId).emit('reactionScoreUpdated', player.reactionScore);
    }
}

module.exports = { server };