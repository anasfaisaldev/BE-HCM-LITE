import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: String,
    kind: { type: String, enum: ['chat', 'dashboard_summary', 'leave_parse'], required: true },
    prompt: String,
    toolCalls: [{ _id: false, name: String, input: mongoose.Schema.Types.Mixed, error: String }],
    response: String,
    status: { type: String, enum: ['ok', 'fallback', 'error'], required: true },
    error: String,
    model: String,
    latencyMs: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ user: 1, createdAt: -1 }); // powers the per-user hourly rate limit
export const AILog = mongoose.model('AILog', schema);
