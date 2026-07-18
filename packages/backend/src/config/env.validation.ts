import { z } from 'zod';

/**
 * Centralized, type-safe environment validation.
 * Any missing/invalid env var fails fast at boot with a clear error.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be ≥ 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be ≥ 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // 32 bytes encoded as 64 hex chars
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  FOREIGN_PROXY_URL: z.string().url().or(z.literal('')).default(''),
  FOREIGN_PROXY_USERNAME: z.string().default(''),
  FOREIGN_PROXY_PASSWORD: z.string().default(''),

  HTTP_TIMEOUT_DIRECT_MS: z.coerce.number().int().positive().default(15_000),
  HTTP_TIMEOUT_PROXY_MS: z.coerce.number().int().positive().default(30_000),
  HTTP_RETRIES_DIRECT: z.coerce.number().int().min(0).max(10).default(2),
  HTTP_RETRIES_PROXY: z.coerce.number().int().min(0).max(10).default(3),

  THROTTLE_TTL: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(5),

  REDIS_URL: z.string().url().or(z.literal('')).default(''),
  ANTHROPIC_API_KEY: z.string().default(''),

  // Phase 5: AI product matching thresholds (0–100)
  MATCH_FUZZY_DEFINITE: z.coerce.number().min(0).max(100).default(90),
  MATCH_FUZZY_REJECT: z.coerce.number().min(0).max(100).default(50),
  MATCH_BULK_APPROVE: z.coerce.number().min(0).max(100).default(95),
  MATCH_CLAUDE_MODEL: z.string().default('claude-3-5-haiku-20241022'),
});

export type Environment = z.infer<typeof envSchema>;
