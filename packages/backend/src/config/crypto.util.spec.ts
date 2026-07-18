import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { encrypt, decrypt, maskSecret, sha256Hex } from './crypto.util';

const PLAINTEXT = 'ck_live_abcdef123456';

describe('CryptoUtil (AES-256-GCM)', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
  });
  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('round-trips a plaintext value', () => {
    const ct = encrypt(PLAINTEXT);
    expect(ct).not.toBe(PLAINTEXT);
    expect(decrypt(ct)).toBe(PLAINTEXT);
  });

  it('produces a different ciphertext for the same input (random IV)', () => {
    const a = encrypt(PLAINTEXT);
    const b = encrypt(PLAINTEXT);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(PLAINTEXT);
    expect(decrypt(b)).toBe(PLAINTEXT);
  });

  it('detects tampering of the ciphertext (auth tag failure)', () => {
    const ct = encrypt(PLAINTEXT);
    const flipped = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => decrypt(flipped)).toThrow();
  });

  it('rejects decrypt when the key is wrong', () => {
    const ct = encrypt(PLAINTEXT);
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => decrypt(ct)).toThrow();
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('rejects when ENCRYPTION_KEY is missing or malformed', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = 'not-hex';
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = saved;
  });

  it('masks secrets for safe display, keeping only the tail', () => {
    expect(maskSecret('ck_live_abcdef123456')).toBe('••••••••3456');
    expect(maskSecret('ab')).toBe('••');
    expect(maskSecret('')).toBe('');
  });

  it('sha256Hex is deterministic and 64 hex chars', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
});
