const { Schema, model } = require("mongoose");

const roomSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: 'User'},
    name: { type: String, required: true },
    isActive: { type: Boolean, default: false },
    kickedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`
    timestamps: true,
  }
);

const Room = model("Room", roomSchema);

module.exports = Room;