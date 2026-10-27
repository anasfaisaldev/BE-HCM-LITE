import mongoose from 'mongoose';

export const EMPLOYMENT_STATUSES = ['active', 'probation', 'resigned', 'terminated'];
export const GENDERS = ['male', 'female', 'other'];

const employeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    employeeCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 30 },
    address: { type: String, trim: true, maxlength: 300 },
    gender: { type: String, enum: GENDERS },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation', required: true },
    joiningDate: { type: Date, required: true },
    leavingDate: Date,
    status: { type: String, enum: EMPLOYMENT_STATUSES, default: 'active', index: true },
  },
  { timestamps: true }
);
employeeSchema.index({ name: 1 });

export const Employee = mongoose.model('Employee', employeeSchema);
