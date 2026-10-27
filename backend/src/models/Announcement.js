import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: String,
    expiresAt: Date,
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);
schema.index({ archived: 1, createdAt: -1 });
export const Announcement = mongoose.model('Announcement', schema);
