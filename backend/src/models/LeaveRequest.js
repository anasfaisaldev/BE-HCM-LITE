import mongoose from 'mongoose';

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

const schema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    leaveType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    year: { type: Number, required: true },
    days: { type: Number, required: true, min: 0.5 }, // working days only
    reason: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: LEAVE_STATUSES, default: 'pending' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decisionComment: String,
    decidedAt: Date,
  },
  { timestamps: true }
);
schema.index({ employee: 1, status: 1, startDate: 1, endDate: 1 });
schema.index({ status: 1, createdAt: -1 });

export const LeaveRequest = mongoose.model('LeaveRequest', schema);
