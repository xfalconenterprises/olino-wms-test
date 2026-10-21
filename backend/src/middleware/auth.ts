import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

export type UserModule = 'PURCHASE' | 'WAREHOUSE' | 'INVENTORY' | 'ADMINISTRATION';

// What a signed token carries. `scope: 'reset'` tokens may only call the
// first-login password/PIN reset endpoints.
export interface TokenPayload {
  userId: string;
  username: string;
  scope?: 'reset';
  iat?: number;
  exp?: number;
}

// The current user as loaded from the database on every request
export interface AuthUser {
  userId: string;
  username: string;
  name: string;
  modules: UserModule[];
  permissions: string[];
}

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_DURATION = '8h';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to backend/.env (see .env.example).');
  }
  return secret;
}

// Fail at startup rather than on the first login
getJwtSecret();

export function signToken(user: { id: string; username: string }, scope?: 'reset'): string {
  const payload: TokenPayload = { userId: user.id, username: user.username, ...(scope && { scope }) };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: SESSION_DURATION });
}

// Mirrors frontend utils/roles.ts hasPermission: '*' grants everything, an exact key
// grants that screen, and users with no permission list fall back to their modules.
const MODULE_FALLBACK: Record<string, UserModule[]> = {
  'po.': ['PURCHASE'],
  'ops.': ['WAREHOUSE'],
  'inv.': ['INVENTORY', 'WAREHOUSE'],
  'admin.': ['ADMINISTRATION'],
};

export function userHasPermission(user: AuthUser, ...keys: string[]): boolean {
  const perms = user.permissions || [];
  if (perms.includes('*')) return true;
  if (keys.some(k => perms.includes(k))) return true;
  if (perms.length === 0) {
    return keys.some(k => {
      const prefix = Object.keys(MODULE_FALLBACK).find(p => k.startsWith(p));
      return prefix ? MODULE_FALLBACK[prefix].some(m => user.modules.includes(m)) : false;
    });
  }
  return false;
}

async function authenticate(req: Request, res: Response, next: NextFunction, allowResetScope: boolean): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized — no authorization token provided in headers' });
    return;
  }

  let decoded: TokenPayload;
  try {
    decoded = jwt.verify(token, getJwtSecret()) as TokenPayload;
  } catch {
    res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
    return;
  }

  if (decoded.scope === 'reset' && !allowResetScope) {
    res.status(403).json({ error: 'Reset your password or PIN before using the system' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { id: true, username: true, name: true, modules: true, permissions: true, isActive: true },
  });
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Unauthorized — user not found or deactivated' });
    return;
  }

  req.user = {
    userId: user.id,
    username: user.username,
    name: user.name,
    modules: user.modules as UserModule[],
    permissions: user.permissions || [],
  };
  next();
}

// ─── Verify JWT and load the current user ────────────────────────────────────
export function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  return authenticate(req, res, next, false);
}

// Accepts limited first-login reset tokens as well as normal session tokens
export function requireResetOrAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  return authenticate(req, res, next, true);
}

// ─── Permission guard ────────────────────────────────────────────────────────
// Access is granted if the user holds AT LEAST ONE of the listed permission keys
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!userHasPermission(req.user, ...permissions)) {
      res.status(403).json({ error: 'Forbidden — you do not have permission to access this resource' });
      return;
    }
    next();
  };
}
