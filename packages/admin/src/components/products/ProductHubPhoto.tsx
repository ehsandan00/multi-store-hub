import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, toApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { compressImageForUpload } from '../../lib/image';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

interface Props {
  /** When omitted, works in create mode with `pendingFile` / `onPendingFileChange`. */
  productId?: string;
  hasHubPhoto?: boolean;
  canEdit: boolean;
  size?: 'sm' | 'md';
  pendingFile?: File | null;
  onPendingFileChange?: (file: File | null) => void;
}

export function ProductHubPhoto({
  productId,
  hasHubPhoto = false,
  canEdit,
  size = 'md',
  pendingFile = null,
  onPendingFileChange,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localHasPhoto, setLocalHasPhoto] = useState(hasHubPhoto);
  const isPendingMode = !productId && !!onPendingFileChange;

  useEffect(() => {
    setLocalHasPhoto(hasHubPhoto);
  }, [hasHubPhoto]);

  useEffect(() => {
    if (isPendingMode) {
      if (!pendingFile) {
        setPreviewUrl(null);
        return;
      }
      const url = URL.createObjectURL(pendingFile);
      setPreviewUrl(url);
      setLocalHasPhoto(true);
      return () => URL.revokeObjectURL(url);
    }

    if (!localHasPhoto || !productId) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    productsApi
      .hubPhotoBlob(productId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (active) setPreviewUrl(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [productId, localHasPhoto, isPendingMode, pendingFile]);

  const uploadMut = useMutation({
    mutationFn: (file: File) => productsApi.uploadHubPhoto(productId!, file),
    onSuccess: () => {
      toast.success(t('products.hubPhotoSaved'));
      setLocalHasPhoto(true);
      qc.invalidateQueries({ queryKey: ['products'] });
      if (productId) qc.invalidateQueries({ queryKey: ['products', productId] });
    },
    onError: (err) => toast.error(t('products.hubPhotoFailed'), toApiError(err).message),
  });

  const removeMut = useMutation({
    mutationFn: () => productsApi.removeHubPhoto(productId!),
    onSuccess: () => {
      toast.success(t('products.hubPhotoRemoved'));
      setLocalHasPhoto(false);
      qc.invalidateQueries({ queryKey: ['products'] });
      if (productId) qc.invalidateQueries({ queryKey: ['products', productId] });
    },
    onError: (err) => toast.error(t('products.hubPhotoRemoveFailed'), toApiError(err).message),
  });

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compressImageForUpload(file);
      const compressed = new File([blob], `${productId ?? 'new'}.jpg`, { type: 'image/jpeg' });

      if (isPendingMode) {
        onPendingFileChange?.(compressed);
        return;
      }

      uploadMut.mutate(compressed);
    } catch (err) {
      toast.error(t('products.hubPhotoFailed'), (err as Error).message);
    }
  }

  function handleRemove() {
    if (isPendingMode) {
      onPendingFileChange?.(null);
      setLocalHasPhoto(false);
      return;
    }
    removeMut.mutate();
  }

  const boxClass =
    size === 'sm' ? 'h-12 w-12 rounded-md' : 'h-36 w-full max-w-xs rounded-lg sm:h-40';

  const busy = uploadMut.isPending || removeMut.isPending;
  const showPhoto = localHasPhoto || !!previewUrl;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {t('products.hubPhoto')}
      </p>
      <p className="text-xs text-slate-500">{t('products.hubPhotoHint')}</p>
      <div className={`relative overflow-hidden border border-slate-200 bg-slate-50 ${boxClass}`}>
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-slate-300">
            📷
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Spinner className="h-5 w-5" />
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={uploadMut.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {showPhoto ? t('products.retakePhoto') : t('products.takePhoto')}
          </Button>
          {showPhoto && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-rose-600 hover:bg-rose-50"
              loading={removeMut.isPending}
              onClick={handleRemove}
            >
              {t('products.removePhoto')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Upload a pending hub photo after product creation. */
export async function uploadPendingHubPhoto(productId: string, file: File): Promise<void> {
  const blob = await compressImageForUpload(file);
  const compressed = new File([blob], `${productId}.jpg`, { type: 'image/jpeg' });
  await productsApi.uploadHubPhoto(productId, compressed);
}
