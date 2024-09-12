const { Schema, model } = require("mongoose");
const { settings } = require("../app");

const roomSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: 'User'},
    name: { type: String, required: true },
    gameSession: { 
      players: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      settings: {
        board: { type: Schema.Types.ObjectId, ref: 'Board'},
        letterBag: { type: Schema.Types.ObjectId, ref: 'LetterBag'},
        turnDuration: { type: Number },
        turnsUntilSkip: { type: Number },
        bankSize: { type: Number }
      }
    },
    messages: [{ type: Schema.Types.ObjectId, ref: 'Message' }],
    kickedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`
    timestamps: true,
  }
);

const Room = model("Room", roomSchema);

module.exports = Room;