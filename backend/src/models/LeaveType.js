import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    annualQuota: { type: Number, min: 0, default: null }, // null = unlimited
    isPaid: { type: Boolean, default: true },
  },
  { timestamps: true }
);
export const LeaveType = mongoose.model('LeaveType', schema);
