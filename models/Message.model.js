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
  generated: { type: Boolean },
  generatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  generatedFor: { type: Schema.Types.ObjectId, ref: 'Game' },
  targetReaction: { type: String },
  reactions: [{
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    type: { type: String },
  }]
});

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;