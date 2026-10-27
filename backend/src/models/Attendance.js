import mongoose from 'mongoose';

export const ATTENDANCE_STATUSES = ['present', 'late', 'half_day', 'missing_checkout'];

const schema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: String, required: true }, // business date in company timezone
    checkIn: { type: Date, required: true },
    checkOut: Date,
    isLate: { type: Boolean, default: false },
    workedMinutes: { type: Number, default: 0 },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    // Camera check result only (no photo is stored). Distance is computed server-side.
    verification: {
      in: { method: String, faceCount: Number, distanceMeters: Number, accuracyMeters: Number },
      out: { method: String, faceCount: Number, distanceMeters: Number, accuracyMeters: Number },
    },
    source: { type: String, enum: ['web', 'correction'], default: 'web' },
  },
  { timestamps: true }
);
schema.index({ employee: 1, date: 1 }, { unique: true }); // one record per employee per day
schema.index({ date: 1, status: 1 });

export const Attendance = mongoose.model('Attendance', schema);
