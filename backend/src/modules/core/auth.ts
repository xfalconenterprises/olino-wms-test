import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import prisma from '../../lib/prisma';
import { MIN_PASSWORD_LENGTH, SESSION_DURATION, floorAccess, requireAuth, requireResetOrAuth, sessionCutoff, signToken } from '../../middleware/auth';
import { END_MESSAGES, SESSION_HOURS, endAllSessions, endSession, openSession } from '../../utils/sessions';

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
  // req.ip is the browser's address, also behind Nginx on this machine (see "trust proxy" in index.ts)
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
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

  // A first-login token can only be used to set a new password; a full login opens a device session
  const token = user.mustResetPassword ? signToken(user, 'reset') : signToken(user, undefined, await openSession(user, req));

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

  // A first-login token can only be used to set a new PIN; a full login opens a device session
  // A badge + PIN session is for Warehouse screens only (see floorAccess)
  const token = user.mustResetPin ? signToken(user, 'reset') : signToken(user, undefined, await openSession(user, req), true);

  res.json({
    ...(user.mustResetPin && { mustResetPin: true }),
    token,
    expiresIn: SESSION_DURATION,
    user: { ...userResponse(user), ...floorAccess(user) },
  });
});

// POST /api/auth/reset-initial-password — First-time web user forces password reset
router.post('/reset-initial-password', requireResetOrAuth, async (req: Request, res: Response) => {
  const { newPassword } = req.body;
  // Only the first-login step (or an administrator's reset) may set the password here; it never
  // asks for the old one, so it is closed once the password has been set
  const current = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { mustResetPassword: true } });
  if (!current?.mustResetPassword) {
    res.status(403).json({ error: 'Your password is already set. Ask an administrator to reset it.' });
    return;
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters long` });
    return;
  }

  const passwordHash = await argon2.hash(newPassword);
  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: {
      passwordHash,
      mustResetPassword: false,
      sessionsValidFrom: sessionCutoff(),
    },
    select: { ...USER_SELECT, maxSessions: true, sessionsValidFrom: true },
  });
  await endAllSessions(updated.id, 'PASSWORD_CHANGED'); // devices signed in with the old password

  res.json({
    message: 'Password updated successfully',
    token: signToken(updated, undefined, await openSession(updated, req)),
    expiresIn: SESSION_DURATION,
    user: userResponse(updated),
  });
});

// POST /api/auth/reset-initial-pin — First-time terminal user forces 6-digit PIN reset
router.post('/reset-initial-pin', requireResetOrAuth, async (req: Request, res: Response) => {
  const { newPin } = req.body;
  const pinDue = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { mustResetPin: true } });
  if (!pinDue?.mustResetPin) {
    res.status(403).json({ error: 'Your PIN is already set. Ask an administrator to reset it.' });
    return;
  }
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
      sessionsValidFrom: sessionCutoff(),
    },
    select: { ...USER_SELECT, maxSessions: true, sessionsValidFrom: true },
  });
  await endAllSessions(updated.id, 'PASSWORD_CHANGED'); // devices signed in with the old PIN

  res.json({
    message: 'PIN updated successfully',
    token: signToken(updated, undefined, await openSession(updated, req), true),   // set at a badge sign-in: Warehouse only
    expiresIn: SESSION_DURATION,
    user: { ...userResponse(updated), ...floorAccess(updated) },
  });
});

// POST /api/auth/logout — ends this device's session, so it leaves the user's device list
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  if (req.sessionId) await endSession(req.sessionId, 'LOGOUT');
  res.json({ success: true });
});

// Wrong attempts to unlock a locked screen, per device; the last one signs the device out
const failedUnlocks = new Map<string, number>();
const MAX_UNLOCK_ATTEMPTS = 5;

// POST /api/auth/unlock — the signed-in person unlocks their locked screen with their password or PIN.
// Wrong answers are a 400 (the screen stays locked); after the last attempt the device is signed out.
// It needs a running session, so it has its own attempt limit instead of using up the login one.
router.post('/unlock', requireAuth, async (req: Request, res: Response) => {
  const { password, pin } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) { res.status(401).json({ error: 'Your session has ended. Please sign in again.' }); return; }

  const cleanPin = String(pin ?? '').trim();
  let valid: boolean;
  if (password) valid = await argon2.verify(user.passwordHash, String(password));
  // A PIN only unlocks a session that was opened with the PIN (Warehouse only)
  else if (cleanPin && !req.floorOnly) { res.status(400).json({ error: 'Unlock with your password.' }); return; }
  else if (cleanPin && !user.pinHash) { res.status(400).json({ error: 'No PIN is set for this account. Use your password.' }); return; }
  else if (cleanPin && user.pinHash) valid = /^\d{6}$/.test(cleanPin) && await argon2.verify(user.pinHash, cleanPin);
  else { res.status(400).json({ error: 'Enter your password or PIN.' }); return; }

  const key = req.sessionId ?? `token:${user.id}`;
  if (!valid) {
    const count = (failedUnlocks.get(key) ?? 0) + 1;
    if (count >= MAX_UNLOCK_ATTEMPTS) {
      failedUnlocks.delete(key);
      if (req.sessionId) await endSession(req.sessionId, 'UNLOCK_FAILED');
      console.warn(`[AUTH] Device of '${user.username}' signed out after ${MAX_UNLOCK_ATTEMPTS} wrong unlock attempts`);
      res.status(401).json({ error: END_MESSAGES.UNLOCK_FAILED });
      return;
    }
    failedUnlocks.set(key, count);
    const left = MAX_UNLOCK_ATTEMPTS - count;
    res.status(400).json({ error: `${password ? 'Incorrect password' : 'Incorrect PIN'}. ${left} attempt${left === 1 ? '' : 's'} left before this device is signed out.` });
    return;
  }
  failedUnlocks.delete(key);

  // A fresh token for the same device, so a long shift never runs into the token's expiry
  let sessionId = req.sessionId;
  if (sessionId) {
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000), lastSeenAt: new Date() },
    });
  } else {
    sessionId = await openSession(user, req);
  }
  res.json({ token: signToken(user, undefined, sessionId, req.floorOnly), expiresIn: SESSION_DURATION });
});

// GET /api/auth/me — validate token and return current user
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { ...USER_SELECT, isActive: true },
  });
  // A badge + PIN session sees only its Warehouse screens
  res.json({ user: user && req.floorOnly ? { ...user, ...floorAccess(user) } : user });
});

export default router;
