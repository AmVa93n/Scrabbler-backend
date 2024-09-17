const { Schema, model } = require("mongoose");

const defaultLetterData = [
    { letter: '', count: 2, points: 0 },
    { letter: 'E', count: 12, points: 1 },
    { letter: 'A', count: 9, points: 1 },
    { letter: 'I', count: 9, points: 1 },
    { letter: 'O', count: 8, points: 1 },
    { letter: 'N', count: 6, points: 1 },
    { letter: 'R', count: 6, points: 1 },
    { letter: 'T', count: 6, points: 1 },
    { letter: 'L', count: 4, points: 1 },
    { letter: 'S', count: 4, points: 1 },
    { letter: 'U', count: 4, points: 1 },
    { letter: 'D', count: 4, points: 2 },
    { letter: 'G', count: 3, points: 2 },
    { letter: 'B', count: 2, points: 3 },
    { letter: 'C', count: 2, points: 3 },
    { letter: 'M', count: 2, points: 3 },
    { letter: 'P', count: 2, points: 3 },
    { letter: 'F', count: 2, points: 4 },
    { letter: 'H', count: 2, points: 4 },
    { letter: 'V', count: 2, points: 4 },
    { letter: 'W', count: 2, points: 4 },
    { letter: 'Y', count: 2, points: 4 },
    { letter: 'K', count: 1, points: 5 },
    { letter: 'J', count: 1, points: 8 },
    { letter: 'X', count: 1, points: 8 },
    { letter: 'Q', count: 1, points: 10 },
    { letter: 'Z', count: 1, points: 10 }
  ];
  
const letterBagSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: 'User'},
    name: { type: String, required: true },
    letterData: {
        type: [{ letter: String, count: Number, points: Number }],
        default: defaultLetterData, 
    },
    default: { type: Boolean },
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`
    timestamps: true,
  }
);

const LetterBag = model("LetterBag", letterBagSchema);

module.exports = LetterBag;