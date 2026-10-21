import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import prisma from '../../lib/prisma';
import { SESSION_DURATION, requireAuth, requireResetOrAuth, signToken } from '../../middleware/auth';

const router = Router();

// In-memory sliding window rate limiter for login protection
interface LoginAttemptRecord {
  count: number;
  resetAt: number;
}
const loginAttempts = new Map<string, LoginAttemptRecord>();
const LOGIN_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_LOGIN_ATTEMPTS = 10;

function loginRateLimiter(req: Request, res: Response, next: () => void) {
  // The app is served directly on the LAN (no proxy), so X-Forwarded-For is client-controlled and ignored
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record) {
    if (now > record.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      record.count++;
      if (record.count > MAX_LOGIN_ATTEMPTS) {
        const waitSec = Math.ceil((record.resetAt - now) / 1000);
        res.status(429).json({
          error: `Too many login attempts. Please wait ${waitSec} seconds before trying again.`
        });
        return;
      }
    }
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  }

  next();
}

// In-memory brute force lockout for 6-digit PIN attempts per badge
interface PinLockoutRecord {
  count: number;
  lockedUntil: number;
}
const failedPinAttempts = new Map<string, PinLockoutRecord>();

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  badgeCode: true,
  modules: true,
  permissions: true,
  mustResetPassword: true,
  mustResetPin: true,
} as const;

type SessionUser = {
  id: string;
  name: string;
  username: string;
  badgeCode: string | null;
  modules: string[];
  permissions: string[];
  mustResetPassword: boolean;
  mustResetPin: boolean;
};

function userResponse(user: SessionUser) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    badgeCode: user.badgeCode,
    modules: user.modules,
    permissions: user.permissions || [],
    mustResetPassword: user.mustResetPassword,
    mustResetPin: user.mustResetPin,
  };
}

// POST /api/auth/login
router.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    console.warn(`[AUTH] Failed login for '${username}' (user not found or inactive)`);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    console.warn(`[AUTH] Failed login for '${username}' (incorrect password)`);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  console.log(`[AUTH] User '${user.username}' (${user.name}) logged in successfully [modules: ${user.modules.join(', ')}]`);

  // A first-login token can only be used to set a new password
  const token = signToken(user, user.mustResetPassword ? 'reset' : undefined);

  res.json({
    ...(user.mustResetPassword && { mustResetPassword: true }),
    token,
    expiresIn: SESSION_DURATION,
    user: userResponse(user),
  });
});

// POST /api/auth/badge-login — Warehouse Floor Quick Scan & 6-Digit PIN
router.post('/badge-login', loginRateLimiter, async (req: Request, res: Response) => {
  const { badgeCode, pin } = req.body;

  if (!badgeCode || !pin) {
    res.status(400).json({ error: 'Badge code and 6-digit PIN are required' });
    return;
  }

  const cleanBadge = String(badgeCode).trim();
  const cleanPin = String(pin).trim();

  if (!/^\d{6}$/.test(cleanPin)) {
    res.status(400).json({ error: 'PIN must be exactly a 6-digit numeric code' });
    return;
  }

  // Check brute-force lockout
  const lockout = failedPinAttempts.get(cleanBadge);
  if (lockout && Date.now() < lockout.lockedUntil) {
    const waitMin = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
    res.status(429).json({
      error: `Badge access temporarily locked due to repeated incorrect PIN attempts. Try again in ${waitMin} minute(s).`
    });
    return;
  }

  // Find user by unique badge code
  const user = await prisma.user.findFirst({
    where: {
      badgeCode: { equals: cleanBadge, mode: 'insensitive' }
    }
  });

  if (!user || !user.isActive || !user.pinHash) {
    res.status(401).json({ error: 'Badge code not registered or PIN not configured' });
    return;
  }

  // Verify PIN with Argon2
  const valid = await argon2.verify(user.pinHash, cleanPin);
  if (!valid) {
    const cur = failedPinAttempts.get(cleanBadge) || { count: 0, lockedUntil: 0 };
    cur.count += 1;
    if (cur.count >= 5) {
      cur.lockedUntil = Date.now() + 10 * 60 * 1000; // 10 minute lockout
      failedPinAttempts.set(cleanBadge, cur);
      res.status(429).json({ error: 'Maximum PIN attempts exceeded. Badge locked for 10 minutes.' });
      return;
    }
    failedPinAttempts.set(cleanBadge, cur);
    res.status(401).json({ error: `Incorrect PIN. ${5 - cur.count} attempt(s) remaining before temporary lockout.` });
    return;
  }

  // Clear failed attempt record on successful login
  failedPinAttempts.delete(cleanBadge);

  console.log(`[AUTH-FLOOR] User '${user.username}' (${user.name}) logged in via badge '${cleanBadge}'`);

  // A first-login token can only be used to set a new PIN
  const token = signToken(user, user.mustResetPin ? 'reset' : undefined);

  res.json({
    ...(user.mustResetPin && { mustResetPin: true }),
    token,
    expiresIn: SESSION_DURATION,
    user: userResponse(user),
  });
});

// POST /api/auth/reset-initial-password — First-time web user forces password reset
router.post('/reset-initial-password', requireResetOrAuth, async (req: Request, res: Response) => {
  const { newPassword } = req.body;
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters long' });
    return;
  }

  const passwordHash = await argon2.hash(newPassword);
  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: {
      passwordHash,
      mustResetPassword: false,
    },
    select: USER_SELECT,
  });

  res.json({
    message: 'Password updated successfully',
    token: signToken(updated),
    expiresIn: SESSION_DURATION,
    user: userResponse(updated),
  });
});

// POST /api/auth/reset-initial-pin — First-time terminal user forces 6-digit PIN reset
router.post('/reset-initial-pin', requireResetOrAuth, async (req: Request, res: Response) => {
  const { newPin } = req.body;
  const cleanPin = String(newPin || '').trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    res.status(400).json({ error: 'New PIN must be exactly 6 numeric digits (0-9)' });
    return;
  }

  const pinHash = await argon2.hash(cleanPin);
  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: {
      pinHash,
      mustResetPin: false,
    },
    select: USER_SELECT,
  });

  res.json({
    message: 'PIN updated successfully',
    token: signToken(updated),
    expiresIn: SESSION_DURATION,
    user: userResponse(updated),
  });
});

// GET /api/auth/me — validate token and return current user
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { ...USER_SELECT, isActive: true },
  });
  res.json({ user });
});

export default router;
