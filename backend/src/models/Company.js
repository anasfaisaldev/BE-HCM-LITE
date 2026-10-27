import mongoose from 'mongoose';

const companySchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true, immutable: true }, // enforces a single company
    name: { type: String, required: true, trim: true, maxlength: 120 },
    officeStart: { type: String, default: '09:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    graceMinutes: { type: Number, default: 15, min: 0, max: 120 },
    weekend: { type: [Number], default: [6, 0] }, // 0 = Sunday ... 6 = Saturday
    timezone: { type: String, default: 'Asia/Karachi' },
    geo: {
      lat: { type: Number, min: -90, max: 90, default: null },
      lng: { type: Number, min: -180, max: 180, default: null },
      radiusMeters: { type: Number, min: 10, max: 5000, default: 200 },
    },
    requireCameraCheckIn: { type: Boolean, default: false },
    rules: {
      halfDayHours: { type: Number, default: 5 },
      weeklyHours: { type: Number, default: 40 },
    },
  },
  { timestamps: true }
);

export const Company = mongoose.model('Company', companySchema);
