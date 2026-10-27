import { Notification } from '../models/Notification.js';

export const notify = (user, type, title, body, link) =>
  Notification.create({ user, type, title, body, link }).catch((e) => console.error('[notify]', e.message));

export async function listNotifications(actor) {
  const [items, unread] = await Promise.all([
    Notification.find({ user: actor._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ user: actor._id, readAt: null }),
  ]);
  return { items, unread };
}
export const markRead = (actor, id) => Notification.updateOne({ _id: id, user: actor._id, readAt: null }, { readAt: new Date() });
export const markAllRead = (actor) => Notification.updateMany({ user: actor._id, readAt: null }, { readAt: new Date() });
