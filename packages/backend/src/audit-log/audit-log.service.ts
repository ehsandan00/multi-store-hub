import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  target?: string | null;
  details?: unknown;
  ipAddress?: string | null;
}

export interface AuditLogRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userFullName: string | null;
  action: string;
  target: string | null;
  details: unknown;
  ipAddress: string | null;
  createdAt: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          target: entry.target ?? null,
          details: (entry.details ? (entry.details as any) : undefined) ?? undefined,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (err) {
      // Audit must never break the request flow.
      this.logger.error(`Failed to write audit log: ${(err as Error).message}`);
    }
  }

  async list(q: {
    userId?: string;
    action?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    data: AuditLogRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const pageSize = Math.min(Math.max(q.pageSize, 1), 100);
    const page = Math.max(q.page, 1);
    const where: Prisma.AuditLogWhereInput = {};
    if (q.userId) where.userId = q.userId;
    if (q.action?.trim()) {
      where.action = { contains: q.action.trim(), mode: 'insensitive' };
    }

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { email: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user?.email ?? null,
        userFullName: r.user?.fullName ?? null,
        action: r.action,
        target: r.target,
        details: r.details,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
