import { Announcement } from '../models/Announcement.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from './auditService.js';

export const listAnnouncements = () =>
  Announcement.find({ archived: false, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ createdAt: -1 }).limit(20).lean();

export async function createAnnouncement(actor, input) {
  const a = await Announcement.create({ ...input, expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T23:59:59Z`) : undefined, createdBy: actor._id, createdByName: actor.name });
  await recordAudit(actor, 'announcement.created', 'Announcement', a._id, null, a.toObject());
  return a;
}
export async function archiveAnnouncement(actor, id) {
  const a = await Announcement.findOneAndUpdate({ _id: id, archived: false }, { archived: true }, { new: true });
  if (!a) throw new ApiError(404, 'Announcement not found');
  await recordAudit(actor, 'announcement.archived', 'Announcement', a._id, { archived: false }, { archived: true });
}
