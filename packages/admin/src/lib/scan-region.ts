/** Center scan box as fractions of image width/height (matches on-screen guide). */
export const SCAN_REGION = {
  left: 0.125,
  top: 0.3,
  width: 0.75,
  height: 0.4,
} as const;

export type ScanRegion = typeof SCAN_REGION;

export async function cropImageToScanRegion(
  file: File,
  region: ScanRegion = SCAN_REGION,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const sx = Math.round(bitmap.width * region.left);
    const sy = Math.round(bitmap.height * region.top);
    const sw = Math.max(1, Math.round(bitmap.width * region.width));
    const sh = Math.max(1, Math.round(bitmap.height * region.height));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');

    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('crop failed'))),
        'image/jpeg',
        0.92,
      );
    });

    return new File([blob], file.name.replace(/\.\w+$/, '') + '-crop.jpg', {
      type: blob.type,
    });
  } finally {
    bitmap.close();
  }
}

export function scanRegionStyle(region: ScanRegion = SCAN_REGION): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${region.left * 100}%`,
    top: `${region.top * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
}
