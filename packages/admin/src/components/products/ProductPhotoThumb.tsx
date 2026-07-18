import { useEffect, useState } from 'react';
import { productsApi } from '../../lib/api';
import { Spinner } from '../ui/Spinner';

interface Props {
  productId: string;
  hasHubPhoto: boolean;
  alt: string;
}

export function ProductPhotoThumb({ productId, hasHubPhoto, alt }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hasHubPhoto) {
      setUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    productsApi
      .hubPhotoBlob(productId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setUrl(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [productId, hasHubPhoto]);

  if (!hasHubPhoto) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-sm text-slate-300">
        —
      </div>
    );
  }

  if (loading && !url) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100">
        <Spinner className="h-4 w-4" />
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-sm text-slate-300">
        📷
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className="h-10 w-10 rounded-md border border-slate-200 object-cover"
    />
  );
}
