import { SCAN_REGION, scanRegionStyle } from '../../lib/scan-region';

interface Props {
  /** When set, shows the uploaded photo; otherwise a dark placeholder. */
  imageUrl?: string | null;
  highlight?: boolean;
  hint: string;
}

/** On-screen guide: dim outside, red box marks the scan area. */
export function ScanRegionGuide({ imageUrl, highlight = false, hint }: Props) {
  const box = scanRegionStyle(SCAN_REGION);

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-slate-400">
            —
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`absolute rounded border-[3px] transition-colors duration-150 ${
              highlight
                ? 'border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.55),0_0_16px_rgba(52,211,153,0.75)]'
                : 'border-red-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.55),0_0_12px_rgba(239,68,68,0.55)]'
            }`}
            style={box}
          />
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">{hint}</p>
    </div>
  );
}
