import prisma from './lib/prisma';
import argon2 from 'argon2';

// Creates the first administrator on an empty database. Safe to re-run: an existing
// admin account is never modified. The default password and PIN must be changed at
// first login.
async function main() {
  console.log('Seeding Olino WMS initial admin account...');

  const existing = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (existing) {
    console.log(`Admin account already exists (id: ${existing.id}); nothing changed.`);
    return;
  }

  const admin = await prisma.user.create({
    data: {
      name: 'System Administrator',
      username: 'admin',
      passwordHash: await argon2.hash('admin123'),
      pinHash: await argon2.hash('112233'),
      badgeCode: 'EMP-0001',
      modules: ['PURCHASE', 'WAREHOUSE', 'INVENTORY', 'ADMINISTRATION'],
      permissions: ['*'],
      isActive: true,
      mustResetPassword: true,
      mustResetPin: true,
    },
  });

  console.log(`Admin account created: ${admin.username} (id: ${admin.id})`);
  console.log('First login: username "admin", password "admin123" (badge EMP-0001, PIN 112233).');
  console.log('You will be asked to choose a new password / PIN immediately.');
}

main()
  .catch((err) => {
    console.error('Seeding error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
