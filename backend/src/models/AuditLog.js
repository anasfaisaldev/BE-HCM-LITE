import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorName: String,
    actorRole: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true },
    entityId: String,
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ createdAt: -1 });

// Immutable: block every update/delete path.
const block = function () {
  throw new Error('Audit logs are immutable');
};
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'replaceOne'].forEach(
  (op) => schema.pre(op, block)
);
schema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit logs are immutable'));
  next();
});

export const AuditLog = mongoose.model('AuditLog', schema);
