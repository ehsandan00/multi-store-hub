import { describe, expect, it } from 'vitest';
import { canUseLiveCamera, cameraErrorMessage } from '../src/lib/camera';

describe('camera', () => {
  it('canUseLiveCamera is false in jsdom (not secure)', () => {
    expect(canUseLiveCamera()).toBe(false);
  });

  it('cameraErrorMessage prefers HTTPS hint when insecure', () => {
    const t = (key: string) => key;
    expect(cameraErrorMessage(new Error('fail'), t)).toBe('products.scanNeedsHttps');
  });

  it('cameraErrorMessage maps permission errors when secure', () => {
    const t = (key: string) => key;
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    try {
      expect(cameraErrorMessage(new DOMException('denied', 'NotAllowedError'), t)).toBe(
        'products.scanCameraPermissionDenied',
      );
    } finally {
      delete (window as Window & { isSecureContext?: boolean }).isSecureContext;
    }
  });
});
