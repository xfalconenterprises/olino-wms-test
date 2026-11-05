import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

/**
 * Signed-in devices. Every full login opens a session row; the login token carries its id, and a
 * token whose session has ended stops working at once. Users may be limited to a number of
 * devices at the same time: a new sign-in beyond the limit ends the least recently used device.
 */

export const SESSION_HOURS = 8;
const SEEN_EVERY_MS = 60_000;          // last-seen time is written at most once a minute
const KEEP_ENDED_DAYS = 30;

export type EndReason = 'SIGNED_OUT' | 'PASSWORD_CHANGED' | 'LOGOUT' | 'DEVICE_LIMIT' | 'UNLOCK_FAILED';

/** What the person on an ended device is told when they are sent to the sign-in screen. */
export const END_MESSAGES: Record<EndReason, string> = {
  SIGNED_OUT: 'You were signed out of this device by an administrator.',
  PASSWORD_CHANGED: 'Your password or PIN was changed. Please sign in again.',
  LOGOUT: 'You have signed out.',
  DEVICE_LIMIT: 'You were signed out because this account signed in on another device.',
  UNLOCK_FAILED: 'Signed out after too many wrong attempts to unlock the screen.',
};

/** "Edge on Windows", "Chrome on Android": enough for someone to recognise their own device. */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Sessions still running for a user (not ended, not expired, not cut off by a password/PIN change). */
export function activeSessionsWhere(userId: string, validFrom: Date | null): Prisma.UserSessionWhereInput {
  return {
    userId,
    endedAt: null,
    expiresAt: { gt: new Date() },
    ...(validFrom && { createdAt: { gte: validFrom } }),
  };
}

/** Ends the least recently used sessions so that at most `keep` stay running. */
export async function trimSessions(user: { id: string; sessionsValidFrom: Date | null }, keep: number, reason: EndReason) {
  const active = await prisma.userSession.findMany({
    where: activeSessionsWhere(user.id, user.sessionsValidFrom),
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true },
  });
  const extra = active.slice(Math.max(0, keep)).map(s => s.id);
  if (extra.length) {
    await prisma.userSession.updateMany({ where: { id: { in: extra } }, data: { endedAt: new Date(), endedReason: reason } });
  }
  return extra.length;
}

/** Opens a session for a full login and returns its id (the token carries it). */
export async function openSession(
  user: { id: string; maxSessions: number | null; sessionsValidFrom: Date | null },
  req: Request,
): Promise<string> {
  const now = Date.now();
  // Housekeeping: rows that ended or expired long ago
  const old = new Date(now - KEEP_ENDED_DAYS * 86_400_000);
  await prisma.userSession.deleteMany({ where: { OR: [{ endedAt: { lt: old } }, { expiresAt: { lt: old } }] } });

  // Room for the new device within the user's limit
  if (user.maxSessions && user.maxSessions > 0) await trimSessions(user, user.maxSessions - 1, 'DEVICE_LIMIT');

  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      device: deviceName(req.get('user-agent')),
      ipAddress: req.ip || null,
      expiresAt: new Date(now + SESSION_HOURS * 3_600_000),
    },
    select: { id: true },
  });
  return session.id;
}

/**
 * Checks that a token's session still runs; returns why it ended otherwise. Also records when the
 * device was last used, at most once a minute.
 */
export async function checkSession(sessionId: string, userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, endedAt: true, endedReason: true, expiresAt: true, lastSeenAt: true },
  });
  if (!session || session.userId !== userId) return { ok: false, message: 'Your session has ended. Please sign in again.' };
  if (session.endedAt) {
    return { ok: false, message: END_MESSAGES[session.endedReason as EndReason] ?? 'Your session has ended. Please sign in again.' };
  }
  if (session.expiresAt.getTime() <= Date.now()) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  if (Date.now() - session.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    await prisma.userSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return { ok: true };
}

/** Ends every running session of a user (sign out everywhere, or a password/PIN change). */
export async function endAllSessions(userId: string, reason: EndReason) {
  const { count } = await prisma.userSession.updateMany({
    where: { userId, endedAt: null, expiresAt: { gt: new Date() } },
    data: { endedAt: new Date(), endedReason: reason },
  });
  return count;
}

/** Ends one session (sign out, administrator action, failed unlock). */
export async function endSession(sessionId: string, reason: EndReason) {
  await prisma.userSession.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt: new Date(), endedReason: reason } });
}
