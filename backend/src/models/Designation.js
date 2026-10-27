import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  { title: { type: String, required: true, unique: true, trim: true, maxlength: 80 } },
  { timestamps: true }
);
export const Designation = mongoose.model('Designation', schema);
