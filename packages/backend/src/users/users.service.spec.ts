import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * In-memory Prisma double scoped to the surface UsersService uses.
 * Importantly: there is NO AuthService here — the regression being covered
 * is that UsersService.changePassword now hashes inline with bcrypt instead
 * of injecting AuthService (which previously broke DI because UsersModule
 * did not import AuthModule).
 */
function fakePrisma(users: any[] = []): any {
  const byId = new Map<string, any>();
  const byEmail = new Map<string, any>();
  for (const u of users) {
    byId.set(u.id, u);
    byEmail.set(u.email, u);
  }
  let id = 0;
  return {
    user: {
      findUnique: async ({ where }: any) =>
        byId.get(where.id) ?? byEmail.get(where.email) ?? null,
      findMany: async () => Array.from(byId.values()),
      create: async ({ data }: any) => {
        const row = { id: `u${++id}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        byId.set(row.id, row);
        byEmail.set(row.email, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = byId.get(where.id);
        if (!existing) throw new Error('not found');
        const merged = { ...existing, ...data, updatedAt: new Date() };
        byId.set(where.id, merged);
        byEmail.set(merged.email, merged);
        return merged;
      },
      delete: async ({ where }: any) => {
        const existing = byId.get(where.id);
        if (!existing) throw new Error('not found');
        byId.delete(where.id);
        byEmail.delete(existing.email);
        return existing;
      },
    },
  };
}

describe('UsersService (no AuthService dependency — DI regression)', () => {
  let svc: UsersService;
  let prisma: any;

  beforeEach(() => {
    prisma = fakePrisma();
    svc = new UsersService(prisma as PrismaService);
  });

  it('create() hashes the password and toSafe() omits the hash', async () => {
    // Service stores the email as passed; lowercasing is the DTO's job
    // (class-validator @Transform). We exercise that layer separately via e2e.
    const u = await svc.create({
      email: 'alice@hub.local',
      fullName: 'Alice',
      password: 'Sup3rSecret!',
      role: Role.WAREHOUSE_STAFF,
    });
    expect(u.email).toBe('alice@hub.local');
    expect((u as any).passwordHash).toBeUndefined();
    const stored = await prisma.user.findUnique({ where: { id: u.id } });
    expect(stored.passwordHash).not.toBe('Sup3rSecret!');
    expect(await bcrypt.compare('Sup3rSecret!', stored.passwordHash)).toBe(true);
  });

  it('create() rejects duplicate emails with ConflictException', async () => {
    await svc.create({ email: 'dup@hub.local', fullName: 'A', password: 'password1', role: Role.VIEWER });
    await expect(
      svc.create({ email: 'dup@hub.local', fullName: 'B', password: 'password2', role: Role.VIEWER }),
    ).rejects.toThrow(ConflictException);
  });

  it('changePassword() hashes the new password inline (no AuthService)', async () => {
    const u = await svc.create({
      email: 'bob@hub.local',
      fullName: 'Bob',
      password: 'oldPassword1',
      role: Role.VIEWER,
    });
    await svc.changePassword(u.id, 'newPassword1');
    const stored = await prisma.user.findUnique({ where: { id: u.id } });
    expect(await bcrypt.compare('oldPassword1', stored.passwordHash)).toBe(false);
    expect(await bcrypt.compare('newPassword1', stored.passwordHash)).toBe(true);
  });

  it('changePassword() enforces the minimum length before hashing', async () => {
    const u = await svc.create({
      email: 'carol@hub.local',
      fullName: 'Carol',
      password: 'longEnough1',
      role: Role.VIEWER,
    });
    await expect(svc.changePassword(u.id, 'short')).rejects.toThrow(ConflictException);
    // Unchanged: original password still verifies.
    const stored = await prisma.user.findUnique({ where: { id: u.id } });
    expect(await bcrypt.compare('longEnough1', stored.passwordHash)).toBe(true);
  });

  it('changePassword() throws NotFound for an unknown user', async () => {
    await expect(svc.changePassword('ghost', 'whatever12')).rejects.toThrow(NotFoundException);
  });

  it('update() throws NotFound for an unknown user', async () => {
    await expect(
      svc.update('ghost', { fullName: 'X', role: Role.ADMIN, isActive: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it('remove() throws NotFound for an unknown user', async () => {
    await expect(svc.remove('ghost')).rejects.toThrow(NotFoundException);
  });

  it('list() returns users without password hashes', async () => {
    await svc.create({ email: 'a@hub.local', fullName: 'A', password: 'password1', role: Role.VIEWER });
    await svc.create({ email: 'b@hub.local', fullName: 'B', password: 'password2', role: Role.ADMIN });
    const rows = await svc.list();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect((r as any).passwordHash).toBeUndefined();
    }
  });
});
