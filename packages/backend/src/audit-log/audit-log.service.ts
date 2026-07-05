import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  target?: string | null;
  details?: unknown;
  ipAddress?: string | null;
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
}
