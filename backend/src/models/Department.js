import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  { name: { type: String, required: true, unique: true, trim: true, maxlength: 80 } },
  { timestamps: true }
);
export const Department = mongoose.model('Department', schema);
