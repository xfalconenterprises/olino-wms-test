import { Router, Request, Response } from 'express';
import argon2 from 'argon2';
import prisma from '../../lib/prisma';
import { requireAuth, requirePermission, userHasPermission, type UserModule } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);

// GET /api/users
router.get('/', requirePermission('admin.users', 'admin.dashboard'), async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      username: true,
      badgeCode: true,
      pinHash: true,
      modules: true,
      permissions: true,
      mustResetPassword: true,
      mustResetPin: true,
      isActive: true,
      createdAt: true
    },
    orderBy: { createdAt: 'desc' },
  });

  const formatted = users.map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    badgeCode: u.badgeCode,
    hasPin: !!u.pinHash,
    modules: u.modules,
    permissions: u.permissions || [],
    mustResetPassword: u.mustResetPassword,
    mustResetPin: u.mustResetPin,
    isActive: u.isActive,
    createdAt: u.createdAt
  }));

  res.json(formatted);
});

// POST /api/users
router.post('/', requirePermission('admin.users'), async (req: Request, res: Response) => {
  const { name, username, password, badgeCode, pin, modules, permissions } = req.body;

  if (!name || !username || !password || !Array.isArray(modules) || modules.length === 0) {
    res.status(400).json({ error: 'Name, username, password, and at least one module are required' });
    return;
  }

  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingUsername) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const cleanBadge = badgeCode ? String(badgeCode).trim() : null;
  if (cleanBadge) {
    const existingBadge = await prisma.user.findFirst({
      where: { badgeCode: { equals: cleanBadge, mode: 'insensitive' } }
    });
    if (existingBadge) {
      res.status(409).json({ error: `Badge code "${cleanBadge}" is already assigned to ${existingBadge.name}` });
      return;
    }
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
  const user = await prisma.user.create({
    data: {
      name,
      username,
      passwordHash,
      badgeCode: cleanBadge,
      pinHash,
      modules: modules as UserModule[],
      permissions: Array.isArray(permissions) ? permissions : [],
      mustResetPassword: true,
      mustResetPin: pinHash ? true : false,
    },
    select: {
      id: true,
      name: true,
      username: true,
      badgeCode: true,
      pinHash: true,
      modules: true,
      permissions: true,
      mustResetPassword: true,
      mustResetPin: true,
      isActive: true,
      createdAt: true
    },
  });

  res.status(201).json({
    id: user.id,
    name: user.name,
    username: user.username,
    badgeCode: user.badgeCode,
    hasPin: !!user.pinHash,
    modules: user.modules,
    permissions: user.permissions || [],
    mustResetPassword: user.mustResetPassword,
    mustResetPin: user.mustResetPin,
    isActive: user.isActive,
    createdAt: user.createdAt
  });
});

// PATCH /api/users/:id
router.patch('/:id', requirePermission('admin.users'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, modules, permissions, isActive, password, badgeCode, pin } = req.body;

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
  if (Array.isArray(modules) && modules.length > 0) updateData.modules = modules as UserModule[];
  if (Array.isArray(permissions)) updateData.permissions = permissions;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (password) {
    updateData.passwordHash = await argon2.hash(password);
    updateData.mustResetPassword = true; // Force password reset on next login
  }

  if (badgeCode !== undefined) {
    const cleanBadge = badgeCode ? String(badgeCode).trim() : null;
    if (cleanBadge) {
      const existingBadge = await prisma.user.findFirst({
        where: {
          badgeCode: { equals: cleanBadge, mode: 'insensitive' },
          id: { not: id as string }
        }
      });
      if (existingBadge) {
        res.status(409).json({ error: `Badge code "${cleanBadge}" is already assigned to ${existingBadge.name}` });
        return;
      }
    }
    updateData.badgeCode = cleanBadge;
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
    }
  }

  const user = await prisma.user.update({
    where: { id: id as string },
    data: updateData,
    select: {
      id: true,
      name: true,
      username: true,
      badgeCode: true,
      pinHash: true,
      modules: true,
      permissions: true,
      mustResetPassword: true,
      mustResetPin: true,
      isActive: true,
      createdAt: true
    },
  });

  res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    badgeCode: user.badgeCode,
    hasPin: !!user.pinHash,
    modules: user.modules,
    permissions: user.permissions || [],
    mustResetPassword: user.mustResetPassword,
    mustResetPin: user.mustResetPin,
    isActive: user.isActive,
    createdAt: user.createdAt
  });
});

export default router;
