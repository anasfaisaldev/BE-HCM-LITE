import { AuditLog } from '../models/AuditLog.js';

export async function recordAudit(actor, action, entity, entityId, before, after) {
  try {
    await AuditLog.create({
      actor: actor?._id, actorName: actor?.name, actorRole: actor?.role,
      action, entity, entityId: entityId ? String(entityId) : undefined, before, after,
    });
  } catch (e) {
    console.error('[audit] failed to write', e.message); // never block the business action
  }
}

export async function listAudit({ page, limit, action }) {
  const filter = action ? { action } : {};
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
}
