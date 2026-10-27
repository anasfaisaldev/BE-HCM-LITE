import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const COOKIE_NAME = 'hcm_token';

export const signToken = (user) => jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpires });

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.nodeEnv === 'production',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
});

/**
 * Loads the user fresh from the DB on every request (role/active changes apply immediately).
 * allowTemp=true lets users with a temporary password reach /me, /logout, /change-password.
 */
export const authenticate = (allowTemp = false) =>
  asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization;
    const token = req.cookies?.[COOKIE_NAME] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) throw new ApiError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new ApiError(401, 'Session expired. Please sign in again.');
    }
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) throw new ApiError(401, 'Account not available');
    if (user.mustChangePassword && !allowTemp) {
      throw new ApiError(403, 'You must change your temporary password first', undefined, 'PASSWORD_CHANGE_REQUIRED');
    }
    req.user = user;
    next();
  });

export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(new ApiError(403, 'You do not have permission to do this'));
  next();
};
