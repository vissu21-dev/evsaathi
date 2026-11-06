import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';
import { sendError } from './errors';

const JWT_SECRET = process.env.JWT_SECRET || 'evsaathi-dev';
const DEMO_OTP = process.env.DEMO_OTP || '123456';

export type AuthUser = { id: string; phoneE164: string; role: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '12h' });
}

export async function hashValue(v: string): Promise<string> {
  return bcrypt.hash(v, 8);
}

export async function compareHash(v: string, hash: string): Promise<boolean> {
  return bcrypt.compare(v, hash);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Missing bearer token');
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AuthUser;
    req.user = payload;
    return next();
  } catch {
    return sendError(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

export async function requestOtp(phoneE164: string) {
  const code = DEMO_OTP;
  const codeHash = await hashValue(code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const row = await prisma.otpRequest.create({
    data: { phoneE164, codeHash, expiresAt },
  });
  // Secure stub: log OTP server-side; SMS provider pending
  console.log(`[EVSaathi OTP stub] phone=${phoneE164} code=${code} request_id=${row.id}`);
  return {
    request_id: row.id,
    expires_in_sec: 300,
    resend_after_sec: 30,
    demo_hint: 'Use OTP 123456 (SMS provider not configured)',
  };
}

export async function verifyOtp(opts: {
  requestId: string;
  code: string;
  deviceId: string;
}) {
  const reqRow = await prisma.otpRequest.findUnique({ where: { id: opts.requestId } });
  if (!reqRow || reqRow.consumed || reqRow.expiresAt < new Date()) {
    return { ok: false as const, error: 'OTP expired or invalid' };
  }
  const match = await compareHash(opts.code, reqRow.codeHash);
  if (!match && opts.code !== DEMO_OTP) {
    return { ok: false as const, error: 'Invalid OTP' };
  }

  await prisma.otpRequest.update({
    where: { id: reqRow.id },
    data: { consumed: true },
  });

  let user = await prisma.user.findUnique({ where: { phoneE164: reqRow.phoneE164 } });
  let isNew = false;
  if (!user) {
    isNew = true;
    user = await prisma.user.create({
      data: {
        phoneE164: reqRow.phoneE164,
        phoneVerifiedAt: new Date(),
        displayName: 'EV driver',
        preferences: { create: {} },
      },
    });
  } else if (!user.phoneVerifiedAt) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date() },
    });
  }

  const refreshRaw = `${user.id}.${opts.deviceId}.${Date.now()}`;
  const tokenHash = await hashValue(refreshRaw);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      deviceId: opts.deviceId,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const authUser: AuthUser = {
    id: user.id,
    phoneE164: user.phoneE164,
    role: user.role,
  };

  return {
    ok: true as const,
    access_token: signAccessToken(authUser),
    refresh_token: refreshRaw,
    expires_in_sec: 12 * 3600,
    user: {
      id: user.id,
      phone_e164: user.phoneE164,
      role: user.role,
      display_name: user.displayName,
      is_new: isNew,
    },
  };
}
