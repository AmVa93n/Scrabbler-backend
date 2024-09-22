const { Schema, model } = require("mongoose");

const gameSchema = new Schema(
  {
    roomId: { type: String },
    hostId: { type: String },
    players: [{ 
        _id: String, 
        name: String, 
        profilePic: String,
        rack: [{
            id: { type: Number },
            letter: { type: String },
            points: { type: Number },
            isBlank: { type: Boolean },
        }],
        score: Number,
        inactiveTurns: Number,
        reactionScore: Number,
    }],
    settings: {
        board: { type: Schema.Types.ObjectId, ref: 'Board'},
        tileBag: { type: Schema.Types.ObjectId, ref: 'TileBag'},
        turnDuration: { type: Number },
        turnsUntilSkip: { type: Number },
        rackSize: { type: Number },
        gameEnd: { type: String },
    },
    state: {
        turnPlayerIndex: { type: Number },
        turnEndTime: { type: Date },
        turnNumber: { type: Number },
        board: [[{ 
            x: Number,
            y: Number,
            occupied: Boolean,
            content: {
                id: { type: Number },
                letter: { type: String },
                points: { type: Number },
                isBlank: { type: Boolean },
            },
            bonusType: String,
            fixed: Boolean,
        }]],
        leftInBag: { type: Number },
        passedTurns: { type: Number },
        isOnCooldown: { type: Boolean },
    },
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`
    timestamps: true,
  }
);

const Game = model("Game", gameSchema);

module.exports = Game;