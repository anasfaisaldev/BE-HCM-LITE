import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    month: { type: String, required: true },
    // snapshot so later edits never change a payslip
    employeeName: String, employeeCode: String, department: String, designation: String, isAdminAccount: { type: Boolean, default: false },
    workingDays: Number, eligibleDays: Number, absentDays: Number, unpaidLeaveDays: Number, halfDays: Number, dailyRate: Number,
    salary: { basic: Number, hra: Number, medical: Number, gross: Number },
    proratedGross: Number,
    deductions: { absence: Number, unpaidLeave: Number, halfDay: Number },
    annualTaxableGross: Number,
    tax: Number,
    net: Number,
    locked: { type: Boolean, default: false },
  },
  { timestamps: true }
);
schema.index({ run: 1, employee: 1 }, { unique: true });
schema.index({ employee: 1, month: -1 });

// Locked payslips are immutable. Draft writes must filter locked:false; only finalize passes allowFinalize.
const guard = function (next) {
  if (this.getOptions().allowFinalize || this.getFilter().locked === false) return next();
  next(new Error('Finalized payslips are immutable'));
};
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => schema.pre(op, guard));
schema.pre('save', function (next) {
  if (!this.isNew && this.locked) return next(new Error('Finalized payslips are immutable'));
  next();
});

export const Payslip = mongoose.model('Payslip', schema);
