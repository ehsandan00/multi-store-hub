export function formatVariationAttributes(attrs: Record<string, string> | null | undefined): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
}

export function parseVariationAttributesText(raw?: string | null): Record<string, string> | null {
  if (!raw?.trim()) return null;
  const out: Record<string, string> = {};
  for (const part of raw.split(/[|;]/)) {
    const seg = part.trim();
    if (!seg) continue;
    const [k, ...rest] = seg.includes('=') ? seg.split('=') : seg.split(':');
    const key = (k ?? '').trim();
    const val = rest.join(seg.includes('=') ? '=' : ':').trim();
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}
