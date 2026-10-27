import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  { date: { type: String, required: true, unique: true }, name: { type: String, required: true, trim: true, maxlength: 100 } },
  { timestamps: true }
);
export const Holiday = mongoose.model('Holiday', schema);
