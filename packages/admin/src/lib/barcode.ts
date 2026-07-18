/** Apply a scanned barcode/QR to product form fields. */
export function applyScannedBarcode(
  code: string,
  opts: {
    setSku: (value: string) => void;
    setBarcode: (value: string) => void;
    currentSku?: string;
  },
): void {
  const trimmed = code.trim();
  if (!trimmed) return;
  opts.setBarcode(trimmed);
  if (!opts.currentSku?.trim()) {
    opts.setSku(trimmed);
  }
}

export function isoDateLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDateLocal(d);
}
