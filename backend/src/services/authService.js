import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { recordAudit } from './auditService.js';

export async function login(email, password) {
  const user = await User.findOne({ email }).select('+passwordHash');
  // Same message for unknown email / wrong password / inactive: no account enumeration.
  const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
  if (!valid) throw new ApiError(401, 'Incorrect email or password');
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new ApiError(422, 'Current password is incorrect', [{ field: 'currentPassword', reason: 'Incorrect' }]);
  if (currentPassword === newPassword) throw new ApiError(422, 'New password must differ from the current one', [{ field: 'newPassword', reason: 'Must be different' }]);
  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();
  await recordAudit(user, 'auth.password_changed', 'User', user._id);
  return user;
}
