import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export const hashPassword = (plain) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Always satisfies the password policy (>= 8 chars, letter + number).
export const generateTempPassword = () => `${crypto.randomBytes(6).toString('base64url')}a1`;
