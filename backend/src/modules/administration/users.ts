import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import prisma from '../../lib/prisma';
import { code128Png } from '../../utils/barcode';
import { ownPasswordRefusal } from './cost-prices';
import { activeSessionsWhere, endAllSessions, endSession, trimSessions } from '../../utils/sessions';
import { requireAuth, requirePermission, userHasPermission, hasCostAccess, COST_PRICE_PERMISSION, MIN_PASSWORD_LENGTH, sessionCutoff, type AuthUser, type UserModule } from '../../middleware/auth';

const router = Router();

// Employee IDs (stored as the badge code) are assigned by the system: EMP-0001, EMP-0002, …
// Floor terminals scan them (then ask for the PIN) and the badge barcode encodes them.
async function nextEmployeeId(): Promise<string> {
  const [row] = await prisma.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("badge_code" FROM 5) AS INTEGER))::int AS n FROM "users" WHERE "badge_code" ~ '^EMP-[0-9]+$'`;
  return `EMP-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

// Characters that are safe in a Code 128 barcode and a file name
const BARCODE_SAFE = /^[A-Z0-9-]{1,30}$/;

/**
 * Confidential cost price access is handed out only by someone who already has it. The first
 * grant (when nobody has it yet) can be made by a full-access administrator.
 */
async function costAccessRefusal(actor: AuthUser, before: string[], after: string[]): Promise<string | null> {
  if (before.includes(COST_PRICE_PERMISSION) === after.includes(COST_PRICE_PERMISSION)) return null;
  if (hasCostAccess(actor)) return null;
  const holders = await prisma.user.count({ where: { isActive: true, permissions: { has: COST_PRICE_PERMISSION } } });
  if (holders === 0 && actor.permissions.includes('*')) return null;
  return 'Only a user who already has Confidential Cost Prices access can give or remove it.';
}

// Giving or removing cost access also takes the person's own password, so it can't happen by a stray click
async function costConfirmRefusal(actor: AuthUser, before: string[], after: string[], password: unknown) {
  if (before.includes(COST_PRICE_PERMISSION) === after.includes(COST_PRICE_PERMISSION)) return null;
  const refusal = await ownPasswordRefusal(actor.userId, actor.username, password);
  return refusal && { ...refusal, code: 'CONFIRM_PASSWORD' };
}

// A 10-digit Indian mobile number; blank clears it, undefined means it isn't valid
function parsePhone(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : undefined;
}

router.use(requireAuth);

// GET /api/users
router.get('/', requirePermission('admin.users', 'admin.dashboard'), async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      username: true,
      phone: true,
      badgeCode: true,
      pinHash: true,
      modules: true,
      permissions: true,
      mustResetPassword: true,
      mustResetPin: true,
      maxSessions: true,
      isActive: true,
      createdAt: true,
      _count: { select: { sessions: { where: { endedAt: null, expiresAt: { gt: new Date() } } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const canSeePhones = userHasPermission(req.user!, 'admin.users');
  const formatted = users.map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    ...(canSeePhones && { phone: u.phone }),
    badgeCode: u.badgeCode,
    hasPin: !!u.pinHash,
    modules: u.modules,
    permissions: u.permissions || [],
    mustResetPassword: u.mustResetPassword,
    mustResetPin: u.mustResetPin,
    maxSessions: u.maxSessions,
    activeSessions: u._count.sessions,
    isActive: u.isActive,
    createdAt: u.createdAt
  }));

  res.json(formatted);
});

// ─── Employee badge barcodes ────────────────────────────────────────────────
// PNG barcodes of the Employee ID for designing badges, with the same barcode specification as
// the rack location labels (Code 128, 0.375 mm bars, 15 mm high, print resolution in the file).

// "EMP-0007 Ravi Kumar.png": the ID first, then the name so the designer knows whose badge it is
function badgeFileName(code: string, name: string): string {
  const safeName = name.replace(/[^A-Za-z0-9 .-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${code}${safeName ? ` ${safeName}` : ''}.png`;
}

// GET /api/users/:id/badge-barcode — one employee's PNG badge barcode
router.get('/:id/badge-barcode', requirePermission('export.employee_barcodes'), async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, select: { name: true, badgeCode: true } });
  const code = (user?.badgeCode ?? '').toUpperCase();
  if (!user || !BARCODE_SAFE.test(code)) { res.status(404).json({ error: 'This user has no Employee ID' }); return; }
  try {
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${badgeFileName(code, user.name)}"`);
    res.send(await code128Png(code));
  } catch (err) {
    console.error('Badge barcode failed:', err);
    res.status(500).json({ error: 'Failed to generate barcode' });
  }
});

const USER_CREATED_SELECT = {
  id: true, name: true, username: true, phone: true, badgeCode: true, pinHash: true, modules: true, permissions: true,
  mustResetPassword: true, mustResetPin: true, maxSessions: true, isActive: true, createdAt: true,
} as const;

// Devices a user may be signed in on at once: blank = no limit, otherwise 1 to 20; new users get 2
const DEFAULT_DEVICE_LIMIT = 2;
const DEVICE_LIMIT_ERROR = 'Devices at the same time must be blank (no limit) or a number from 1 to 20.';
function parseDeviceLimit(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : undefined;
}

// POST /api/users
router.post('/', requirePermission('admin.users'), async (req: Request, res: Response) => {
  const { name, username, password, pin, modules, permissions, phone, confirmPassword, maxSessions } = req.body;

  const deviceLimit = maxSessions === undefined ? DEFAULT_DEVICE_LIMIT : parseDeviceLimit(maxSessions);
  if (deviceLimit === undefined) { res.status(400).json({ error: DEVICE_LIMIT_ERROR }); return; }

  if (!name || !username || !password || !Array.isArray(modules) || modules.length === 0) {
    res.status(400).json({ error: 'Name, username, password, and at least one module are required' });
    return;
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` });
    return;
  }

  const costRefusal = await costAccessRefusal(req.user!, [], Array.isArray(permissions) ? permissions : []);
  if (costRefusal) { res.status(403).json({ error: costRefusal }); return; }
  const confirmRefusal = await costConfirmRefusal(req.user!, [], Array.isArray(permissions) ? permissions : [], confirmPassword);
  if (confirmRefusal) { res.status(confirmRefusal.status).json({ error: confirmRefusal.error, code: confirmRefusal.code }); return; }

  const cleanPhone = parsePhone(phone);
  if (!cleanPhone) { res.status(400).json({ error: 'Enter a 10-digit mobile number.' }); return; }

  // The sign-in box treats EMP-0001-style entries as Employee IDs (then asks for the PIN)
  if (/^emp-\d+$/i.test(String(username).trim())) {
    res.status(400).json({ error: 'Usernames like EMP-0001 are kept for Employee IDs. Choose another username.' });
    return;
  }

  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingUsername) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  let pinHash: string | null = null;
  if (pin) {
    const cleanPin = String(pin).trim();
    if (!/^\d{6}$/.test(cleanPin)) {
      res.status(400).json({ error: 'PIN must be exactly a 6-digit numeric code' });
      return;
    }
    pinHash = await argon2.hash(cleanPin);
  }

  const passwordHash = await argon2.hash(password);
  const data = {
    name,
    username,
    phone: cleanPhone,
    passwordHash,
    pinHash,
    modules: modules as UserModule[],
    permissions: Array.isArray(permissions) ? permissions : [],
    mustResetPassword: true,
    mustResetPin: pinHash ? true : false,
    maxSessions: deviceLimit,
  };
  // The Employee ID is assigned here. Two users saved at the same moment could get the same next
  // ID; the unique index refuses the second, which then takes the following number.
  let user;
  for (let attempt = 0; ; attempt++) {
    try {
      user = await prisma.user.create({ data: { ...data, badgeCode: await nextEmployeeId() }, select: USER_CREATED_SELECT });
      break;
    } catch (err: any) {
      if (err?.code !== 'P2002' || attempt >= 4) throw err;
    }
  }

  res.status(201).json({
    id: user.id,
    name: user.name,
    username: user.username,
    phone: user.phone,
    badgeCode: user.badgeCode,
    hasPin: !!user.pinHash,
    modules: user.modules,
    permissions: user.permissions || [],
    mustResetPassword: user.mustResetPassword,
    mustResetPin: user.mustResetPin,
    maxSessions: user.maxSessions,
    isActive: user.isActive,
    createdAt: user.createdAt
  });
});

// PATCH /api/users/:id
router.patch('/:id', requirePermission('admin.users'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, modules, permissions, isActive, password, pin, phone, confirmPassword, maxSessions } = req.body;

  // Safeguard: Prevent self-deactivation and lockout of the last active user manager
  if (isActive === false && req.user?.userId === id) {
    res.status(400).json({ error: 'You cannot deactivate your own administrative account while logged in.' });
    return;
  }

  const targetUser = await prisma.user.findUnique({ where: { id: id as string } });
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const canManageUsers = (u: { modules: string[]; permissions: string[] }) =>
    userHasPermission({ userId: '', username: '', name: '', modules: u.modules as UserModule[], permissions: u.permissions }, 'admin.users');

  const after = {
    modules: Array.isArray(modules) && modules.length > 0 ? modules : targetUser.modules,
    permissions: Array.isArray(permissions) ? permissions : targetUser.permissions,
  };
  const costRefusal = await costAccessRefusal(req.user!, targetUser.permissions, after.permissions);
  if (costRefusal) { res.status(403).json({ error: costRefusal }); return; }
  const confirmRefusal = await costConfirmRefusal(req.user!, targetUser.permissions, after.permissions, confirmPassword);
  if (confirmRefusal) { res.status(confirmRefusal.status).json({ error: confirmRefusal.error, code: confirmRefusal.code }); return; }
  // Resetting a cost-access holder's password or PIN would let someone sign in as them
  if ((password || pin) && hasCostAccess(targetUser) && !hasCostAccess(req.user!) && req.user!.userId !== id) {
    res.status(403).json({ error: 'Only a user with Confidential Cost Prices access can reset the password or PIN of a user who has it.' });
    return;
  }

  const losesUserManagement = canManageUsers(targetUser) && (isActive === false || !canManageUsers(after));

  if (losesUserManagement) {
    const others = await prisma.user.findMany({
      where: { isActive: true, id: { not: id as string } },
      select: { modules: true, permissions: true },
    });
    if (!others.some(canManageUsers)) {
      res.status(400).json({ error: 'Cannot remove user-management access from the last active administrator.' });
      return;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) {
    const cleanPhone = parsePhone(phone);
    if (cleanPhone === undefined || (cleanPhone === null && targetUser.phone)) {
      res.status(400).json({ error: 'Enter a 10-digit mobile number.' });
      return;
    }
    updateData.phone = cleanPhone;
  }
  if (Array.isArray(modules) && modules.length > 0) updateData.modules = modules as UserModule[];
  if (Array.isArray(permissions)) updateData.permissions = permissions;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (maxSessions !== undefined) {
    const deviceLimit = parseDeviceLimit(maxSessions);
    if (deviceLimit === undefined) { res.status(400).json({ error: DEVICE_LIMIT_ERROR }); return; }
    updateData.maxSessions = deviceLimit;
  }
  if (password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` });
      return;
    }
    updateData.passwordHash = await argon2.hash(password);
    updateData.mustResetPassword = true; // Force password reset on next login
    updateData.sessionsValidFrom = sessionCutoff(); // and sign out sessions opened with the old one
  }


  if (pin !== undefined) {
    if (pin === null || pin === '') {
      updateData.pinHash = null;
      updateData.mustResetPin = false;
    } else {
      const cleanPin = String(pin).trim();
      if (!/^\d{6}$/.test(cleanPin)) {
        res.status(400).json({ error: 'PIN must be exactly a 6-digit numeric code' });
        return;
      }
      updateData.pinHash = await argon2.hash(cleanPin);
      updateData.mustResetPin = true; // Force PIN reset on next terminal login
      updateData.sessionsValidFrom = sessionCutoff();
    }
  }

  const user = await prisma.user.update({
    where: { id: id as string },
    data: updateData,
    select: {
      id: true,
      name: true,
      username: true,
      phone: true,
      badgeCode: true,
      pinHash: true,
      modules: true,
      permissions: true,
      mustResetPassword: true,
      mustResetPin: true,
      maxSessions: true,
      sessionsValidFrom: true,
      isActive: true,
      createdAt: true
    },
  });

  // A new password or PIN, or deactivation, ends every device; a lower device limit ends the least recently used ones
  if (updateData.sessionsValidFrom) await endAllSessions(user.id, 'PASSWORD_CHANGED');
  else if (isActive === false) await endAllSessions(user.id, 'SIGNED_OUT');
  else if (user.maxSessions) await trimSessions(user, user.maxSessions, 'DEVICE_LIMIT');

  res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    phone: user.phone,
    badgeCode: user.badgeCode,
    hasPin: !!user.pinHash,
    modules: user.modules,
    permissions: user.permissions || [],
    mustResetPassword: user.mustResetPassword,
    mustResetPin: user.mustResetPin,
    maxSessions: user.maxSessions,
    isActive: user.isActive,
    createdAt: user.createdAt
  });
});

// ─── Signed-in devices ───────────────────────────────────────────────────────

// GET /api/users/:id/sessions — the devices a user is signed in on now, most recently used first
router.get('/:id/sessions', requirePermission('admin.users'), async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, select: { id: true, sessionsValidFrom: true } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const sessions = await prisma.userSession.findMany({
    where: activeSessionsWhere(user.id, user.sessionsValidFrom),
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, device: true, ipAddress: true, createdAt: true, lastSeenAt: true },
  });
  res.json(sessions.map(s => ({ ...s, current: s.id === req.sessionId })));
});

// DELETE /api/users/:id/sessions/:sessionId — sign one device out
router.delete('/:id/sessions/:sessionId', requirePermission('admin.users'), async (req: Request, res: Response) => {
  const session = await prisma.userSession.findUnique({ where: { id: String(req.params.sessionId) }, select: { userId: true } });
  if (!session || session.userId !== String(req.params.id)) { res.status(404).json({ error: 'Device not found' }); return; }
  await endSession(String(req.params.sessionId), 'SIGNED_OUT');
  res.json({ success: true });
});

// POST /api/users/:id/sign-out-all — sign the user out on every device (lost phone, someone leaving)
router.post('/:id/sign-out-all', requirePermission('admin.users'), async (req: Request, res: Response) => {
  const target = await prisma.user.findUnique({ where: { id: String(req.params.id) }, select: { id: true, username: true } });
  if (!target) { res.status(404).json({ error: 'User not found' }); return; }
  const ended = await endAllSessions(target.id, 'SIGNED_OUT');
  // Also ends logins from before devices were tracked
  await prisma.user.update({ where: { id: target.id }, data: { sessionsValidFrom: sessionCutoff() } });
  console.log(`[AUTH] '${req.user!.username}' signed '${target.username}' out of all devices (${ended})`);
  res.json({ success: true, ended });
});

export default router;
