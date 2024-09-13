const { Schema, model } = require("mongoose");

const defaultBonusTiles = [
    // Triple Word Score
    { x: 0, y: 0, bonusType: 'tripleWord' },
    { x: 0, y: 7, bonusType: 'tripleWord' },
    { x: 0, y: 14, bonusType: 'tripleWord' },
    { x: 7, y: 0, bonusType: 'tripleWord' },
    { x: 7, y: 14, bonusType: 'tripleWord' },
    { x: 14, y: 0, bonusType: 'tripleWord' },
    { x: 14, y: 7, bonusType: 'tripleWord' },
    { x: 14, y: 14, bonusType: 'tripleWord' },
  
    // Double Word Score
    { x: 1, y: 1, bonusType: 'doubleWord' },
    { x: 2, y: 2, bonusType: 'doubleWord' },
    { x: 3, y: 3, bonusType: 'doubleWord' },
    { x: 4, y: 4, bonusType: 'doubleWord' },
    { x: 7, y: 7, bonusType: 'doubleWord' },
    { x: 10, y: 10, bonusType: 'doubleWord' },
    { x: 11, y: 11, bonusType: 'doubleWord' },
    { x: 12, y: 12, bonusType: 'doubleWord' },
    { x: 13, y: 13, bonusType: 'doubleWord' },
    { x: 1, y: 13, bonusType: 'doubleWord' },
    { x: 2, y: 12, bonusType: 'doubleWord' },
    { x: 3, y: 11, bonusType: 'doubleWord' },
    { x: 4, y: 10, bonusType: 'doubleWord' },
    { x: 10, y: 4, bonusType: 'doubleWord' },
    { x: 11, y: 3, bonusType: 'doubleWord' },
    { x: 12, y: 2, bonusType: 'doubleWord' },
    { x: 13, y: 1, bonusType: 'doubleWord' },
  
    // Triple Letter Score
    { x: 1, y: 5, bonusType: 'tripleLetter' },
    { x: 1, y: 9, bonusType: 'tripleLetter' },
    { x: 5, y: 1, bonusType: 'tripleLetter' },
    { x: 5, y: 5, bonusType: 'tripleLetter' },
    { x: 5, y: 9, bonusType: 'tripleLetter' },
    { x: 5, y: 13, bonusType: 'tripleLetter' },
    { x: 9, y: 1, bonusType: 'tripleLetter' },
    { x: 9, y: 5, bonusType: 'tripleLetter' },
    { x: 9, y: 9, bonusType: 'tripleLetter' },
    { x: 9, y: 13, bonusType: 'tripleLetter' },
    { x: 13, y: 5, bonusType: 'tripleLetter' },
    { x: 13, y: 9, bonusType: 'tripleLetter' },
  
    // Double Letter Score
    { x: 0, y: 3, bonusType: 'doubleLetter' },
    { x: 0, y: 11, bonusType: 'doubleLetter' },
    { x: 2, y: 6, bonusType: 'doubleLetter' },
    { x: 2, y: 8, bonusType: 'doubleLetter' },
    { x: 3, y: 0, bonusType: 'doubleLetter' },
    { x: 3, y: 7, bonusType: 'doubleLetter' },
    { x: 3, y: 14, bonusType: 'doubleLetter' },
    { x: 6, y: 2, bonusType: 'doubleLetter' },
    { x: 6, y: 6, bonusType: 'doubleLetter' },
    { x: 6, y: 8, bonusType: 'doubleLetter' },
    { x: 6, y: 12, bonusType: 'doubleLetter' },
    { x: 7, y: 3, bonusType: 'doubleLetter' },
    { x: 7, y: 11, bonusType: 'doubleLetter' },
    { x: 8, y: 2, bonusType: 'doubleLetter' },
    { x: 8, y: 6, bonusType: 'doubleLetter' },
    { x: 8, y: 8, bonusType: 'doubleLetter' },
    { x: 8, y: 12, bonusType: 'doubleLetter' },
    { x: 11, y: 0, bonusType: 'doubleLetter' },
    { x: 11, y: 7, bonusType: 'doubleLetter' },
    { x: 11, y: 14, bonusType: 'doubleLetter' },
    { x: 12, y: 6, bonusType: 'doubleLetter' },
    { x: 12, y: 8, bonusType: 'doubleLetter' },
    { x: 14, y: 3, bonusType: 'doubleLetter' },
    { x: 14, y: 11, bonusType: 'doubleLetter' }
]

const boardSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: 'User'},
    name: { type: String, required: true },
    size: { type: Number, default: 15 },
    bonusTiles: {
        type: [{ x: Number, y: Number, bonusType: String }],
        default: defaultBonusTiles,
    },
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`
    timestamps: true,
  }
);

const Board = model("Board", boardSchema);

module.exports = Board;