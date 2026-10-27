import mongoose from 'mongoose';

// Append-only history; the latest effectiveFrom is the current structure.
const schema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    basic: { type: Number, required: true, min: 0.01 },
    hra: { type: Number, required: true },
    medical: { type: Number, required: true },
    gross: { type: Number, required: true },
    effectiveFrom: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
schema.index({ employee: 1, effectiveFrom: -1 });

export const SalaryStructure = mongoose.model('SalaryStructure', schema);
