import { randomBytes } from 'crypto';

export const JWT_SECRET =
  process.env.JWT_SECRET?.trim() || randomBytes(64).toString('hex');
