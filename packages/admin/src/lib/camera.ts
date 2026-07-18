/** Live camera (getUserMedia) works only in secure contexts — not on http://192.168.x.x phones. */
export function canUseLiveCamera(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.isSecureContext);
}

export function cameraErrorMessage(err: unknown, t: (key: string) => string): string {
  if (!canUseLiveCamera()) return t('products.scanNeedsHttps');

  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return t('products.scanCameraPermissionDenied');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return t('products.scanCameraNotFound');
  }
  return t('products.scanCameraFailed');
}
