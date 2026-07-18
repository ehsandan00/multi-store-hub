import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../../lib/toast';
import { cameraErrorMessage, canUseLiveCamera } from '../../lib/camera';
import { extractTextFromImageFile, pickOcrSearchQueries } from '../../lib/ocr';
import { cropImageToScanRegion } from '../../lib/scan-region';
import type { ScanSource } from '../../lib/product-scan';
import { ScanRegionGuide } from './ScanRegionGuide';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Return false to keep the scanner open and try again. */
  onScan: (
    value: string,
    meta?: { source: ScanSource },
  ) => void | boolean | Promise<void | boolean>;
}

type PhotoPreview = {
  file: File;
  url: string;
  mode: 'barcode' | 'name';
};

type ScannerControls = { stop: () => void };
type ScannerReader = {
  decodeFromVideoDevice: (
    deviceId: string | undefined,
    video: HTMLVideoElement,
    cb: (result: { getText: () => string } | undefined) => void,
  ) => Promise<ScannerControls>;
  decodeFromImageUrl: (url: string) => Promise<{ getText: () => string } | undefined>;
};

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('canplay', done);
      resolve();
    };
    video.addEventListener('loadeddata', done);
    video.addEventListener('canplay', done);
    window.setTimeout(done, 3000);
  });
}

export function BarcodeScannerModal({ open, onClose, onScan }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoModeRef = useRef<'barcode' | 'name'>('barcode');
  const previewUrlRef = useRef<string | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const busyRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const [loadingScanner, setLoadingScanner] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [codeInFrame, setCodeInFrame] = useState(false);
  const [photoOnly, setPhotoOnly] = useState(false);
  const [cameraHint, setCameraHint] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<PhotoPreview | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPhotoPreview(null);
    setCodeInFrame(false);
  }, []);

  const clearFrameTimer = useCallback(() => {
    if (frameTimerRef.current) {
      clearTimeout(frameTimerRef.current);
      frameTimerRef.current = null;
    }
  }, []);

  const markCodeInFrame = useCallback(() => {
    setCodeInFrame(true);
    clearFrameTimer();
    frameTimerRef.current = setTimeout(() => {
      setCodeInFrame(false);
      frameTimerRef.current = null;
    }, 450);
  }, [clearFrameTimer]);

  const handleScanValue = useCallback(
    async (value: string, source: ScanSource = 'barcode') => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await Promise.resolve(onScanRef.current(value.trim(), { source }));
        if (result !== false) {
          onCloseRef.current();
        } else {
          busyRef.current = false;
          setCodeInFrame(false);
          clearFrameTimer();
        }
      } catch {
        busyRef.current = false;
        setCodeInFrame(false);
        clearFrameTimer();
      }
    },
    [clearFrameTimer],
  );

  const openPhotoPicker = useCallback((mode: 'barcode' | 'name') => {
    photoModeRef.current = mode;
    fileRef.current?.click();
  }, []);

  const decodeNameFromFile = useCallback(
    async (file: File) => {
      const text = await extractTextFromImageFile(file);
      const queries = pickOcrSearchQueries(text);
      if (!queries.length) {
        toast.error(t('products.scanOcrFailed'));
        return false;
      }
      markCodeInFrame();
      await handleScanValue(text, 'ocr');
      return true;
    },
    [handleScanValue, markCodeInFrame, t, toast],
  );

  const decodeBarcodeFromFile = useCallback(
    async (file: File) => {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader() as unknown as ScannerReader;
      const url = URL.createObjectURL(file);
      try {
        const result = await reader.decodeFromImageUrl(url);
        const text = result?.getText()?.trim();
        if (!text) throw new Error('no barcode');
        markCodeInFrame();
        await handleScanValue(text, 'barcode');
        return true;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [handleScanValue, markCodeInFrame],
  );

  const runPhotoScan = useCallback(
    async (preview: PhotoPreview) => {
      setProcessingPhoto(true);
      try {
        let cropped: File;
        try {
          cropped = await cropImageToScanRegion(preview.file);
        } catch {
          cropped = preview.file;
        }

        if (preview.mode === 'name') {
          const ok = await decodeNameFromFile(cropped);
          if (!ok) return;
          return;
        }

        try {
          await decodeBarcodeFromFile(cropped);
        } catch {
          try {
            await decodeBarcodeFromFile(preview.file);
          } catch {
            toast.info(t('products.scanBarcodeTryOcr'));
            const ok = await decodeNameFromFile(cropped);
            if (!ok) {
              toast.error(t('products.scanPhotoFailed'));
            }
          }
        }
      } finally {
        setProcessingPhoto(false);
      }
    },
    [decodeBarcodeFromFile, decodeNameFromFile, t, toast],
  );

  useEffect(() => {
    if (!open) {
      busyRef.current = false;
      setCodeInFrame(false);
      setLoadingScanner(false);
      setProcessingPhoto(false);
      setPhotoOnly(false);
      setCameraHint(null);
      clearPreview();
      clearFrameTimer();
      return;
    }

    if (!canUseLiveCamera()) {
      setPhotoOnly(true);
      setCameraHint(t('products.scanNeedsHttps'));
      setLoadingScanner(false);
      return;
    }

    let cancelled = false;
    busyRef.current = false;
    setPhotoOnly(false);
    setCameraHint(null);
    setCodeInFrame(false);
    setLoadingScanner(true);

    void (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;

        await waitForVideoReady(videoRef.current);
        if (cancelled || !videoRef.current) return;

        const reader = new BrowserMultiFormatReader() as unknown as ScannerReader;
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          const text = result?.getText()?.trim();
          if (!text) return;
          markCodeInFrame();
          if (busyRef.current) return;
          void handleScanValue(text, 'barcode');
        });
        if (!cancelled) controlsRef.current = controls;
      } catch (err) {
        if (cancelled) return;
        const msg = cameraErrorMessage(err, t);
        setPhotoOnly(true);
        setCameraHint(msg);
        toast.error(msg);
      } finally {
        if (!cancelled) setLoadingScanner(false);
      }
    })();

    return () => {
      cancelled = true;
      clearFrameTimer();
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, handleScanValue, markCodeInFrame, clearFrameTimer, clearPreview, t, toast]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function onPhotoSelected(file: File | undefined) {
    if (!file) return;
    clearPreview();
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPhotoPreview({ file, url, mode: photoModeRef.current });
  }

  const photoButtons = (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant={photoOnly && !photoPreview ? 'primary' : 'secondary'}
        size="sm"
        disabled={processingPhoto}
        onClick={() => openPhotoPicker('barcode')}
      >
        {t('products.scanFromPhoto')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={processingPhoto}
        onClick={() => openPhotoPicker('name')}
      >
        {t('products.scanFromName')}
      </Button>
    </div>
  );

  const previewHint = photoPreview
    ? photoPreview.mode === 'name'
      ? t('products.scanPhotoNameBoxHint')
      : t('products.scanPhotoBoxHint')
    : t('products.scanPhotoEmptyBoxHint');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('products.scanBarcode')}
      description={photoOnly ? t('products.scanPhotoOnlyHint') : t('products.scanBarcodeHint')}
      size="md"
      footer={
        <Button variant="secondary" type="button" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      }
    >
      <div className="space-y-3">
        {photoPreview ? (
          <>
            <ScanRegionGuide
              imageUrl={photoPreview.url}
              highlight={codeInFrame}
              hint={previewHint}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                loading={processingPhoto}
                onClick={() => void runPhotoScan(photoPreview)}
              >
                {t('products.scanPhotoConfirm')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={processingPhoto}
                onClick={clearPreview}
              >
                {t('products.scanPhotoRetry')}
              </Button>
            </div>
          </>
        ) : photoOnly ? (
          <div className="space-y-3">
            <ScanRegionGuide hint={t('products.scanPhotoEmptyBoxHint')} />
            {cameraHint && <p className="text-center text-sm text-slate-600">{cameraHint}</p>}
            {photoButtons}
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline autoPlay />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`h-32 w-56 rounded border-[3px] transition-colors duration-150 ${
                  codeInFrame
                    ? 'border-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.75)]'
                    : 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.55)]'
                }`}
              />
            </div>
            {loadingScanner && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Spinner className="h-6 w-6 text-white" />
              </div>
            )}
          </div>
        )}

        {!photoOnly && !photoPreview && (
          <p className="flex items-center gap-2 text-xs">
            {loadingScanner ? (
              <>
                <Spinner className="h-4 w-4 text-slate-400" />
                <span className="text-slate-500">{t('products.scanStarting')}</span>
              </>
            ) : codeInFrame ? (
              <span className="font-medium text-emerald-600">{t('products.scanInFrame')}</span>
            ) : (
              <span className="font-medium text-red-600">{t('products.scanOutOfFrame')}</span>
            )}
          </p>
        )}

        {processingPhoto && photoPreview && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Spinner className="h-4 w-4" />
            {photoPreview.mode === 'name'
              ? t('products.scanOcrProcessing')
              : t('products.scanStarting')}
          </p>
        )}

        {!photoPreview && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                onPhotoSelected(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {!photoOnly && photoButtons}
            <p className="text-xs text-slate-500">{t('products.scanNameHint')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
