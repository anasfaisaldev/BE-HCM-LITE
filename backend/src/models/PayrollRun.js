import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: ['draft', 'finalized'], default: 'draft' },
    workingDays: { type: Number, required: true },
    totals: { headcount: Number, gross: Number, deductions: Number, tax: Number, net: Number },
    skipped: [{ _id: false, employeeCode: String, name: String, reason: String }],
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedAt: Date,
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    finalizedAt: Date,
  },
  { timestamps: true }
);

// Finalized runs are immutable: writes must target status:'draft' (finalize itself does so atomically).
const guard = function (next) {
  if (this.getFilter().status === 'draft') return next();
  next(new Error('Finalized payroll is locked'));
};
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => schema.pre(op, guard));
schema.pre('save', function (next) {
  if (!this.isNew && this.status === 'finalized') return next(new Error('Finalized payroll is locked'));
  next();
});

export const PayrollRun = mongoose.model('PayrollRun', schema);
