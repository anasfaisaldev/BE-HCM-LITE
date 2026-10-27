import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    date: { type: String, required: true },
    checkIn: String, // requested local HH:MM
    checkOut: String,
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decisionComment: String,
    decidedAt: Date,
  },
  { timestamps: true }
);
export const AttendanceCorrection = mongoose.model('AttendanceCorrection', schema);
