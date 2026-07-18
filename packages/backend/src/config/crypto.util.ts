import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * AES-256-GCM encrypt/decrypt for secrets at rest (WooCommerce consumer key/secret).
 *
 * Storage format (single string, base64):
 *   base64( iv(12B) || ciphertext || authTag(16B) )
 *
 * Why GCM: authenticated encryption — tampering of ciphertext or IV is detected
 * on decrypt and throws. Why IV per record: standard practice, prevents reuse.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV is the GCM standard
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'ENCRYPTION_KEY is missing or malformed (must be 64 hex chars / 32 bytes). ' +
        'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(raw, 'hex');
}

/** Returns base64(iv || ciphertext || authTag). */
export function encrypt(plain: string): string {
  if (plain == null) throw new Error('encrypt(): plaintext required');
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

/** Decrypts a payload produced by `encrypt()`. Throws on tamper / wrong key. */
export function decrypt(payload: string): string {
  if (!payload) throw new Error('decrypt(): payload required');
  const key = getKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('decrypt(): payload too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/** Mask a secret for safe display, e.g. `ck_live_abcdef1234` → `••••••••1234`. */
export function maskSecret(secret: string, visibleTail = 4): string {
  if (!secret) return '';
  if (secret.length <= visibleTail) return '•'.repeat(secret.length);
  return '•'.repeat(8) + secret.slice(-visibleTail);
}

/** Deterministic SHA-256 hash (hex) — used for indexing/lookup if needed. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
