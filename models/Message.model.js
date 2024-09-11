const mongoose = require('mongoose');
const { Schema } = mongoose;

const messageSchema = new mongoose.Schema({
  sender: { type: Schema.Types.ObjectId, ref: 'User' },
  recipient: { type: Schema.Types.ObjectId, ref: 'User' },
  text: { type: String },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  title: { type: String },
  minor: { type: Boolean },
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;