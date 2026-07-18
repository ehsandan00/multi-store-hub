import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveProductScan } from '../src/lib/product-scan';

vi.mock('../src/lib/api', () => ({
  productsApi: {
    lookup: vi.fn(),
    list: vi.fn(),
  },
}));

import { productsApi } from '../src/lib/api';

describe('resolveProductScan', () => {
  beforeEach(() => {
    vi.mocked(productsApi.lookup).mockReset();
    vi.mocked(productsApi.list).mockReset();
  });

  it('returns product for exact barcode lookup', async () => {
    vi.mocked(productsApi.lookup).mockResolvedValue({ id: 'p1', name: 'Test' } as never);
    const result = await resolveProductScan('123', 'barcode');
    expect(result).toEqual({ kind: 'product', product: { id: 'p1', name: 'Test' } });
  });

  it('searches by OCR text lines', async () => {
    vi.mocked(productsApi.list).mockResolvedValue({
      data: [{ id: 'p2', name: 'Shampoo' }],
      total: 1,
      page: 1,
      pageSize: 10,
    } as never);

    const result = await resolveProductScan('Shampoo\n500ml', 'ocr');
    expect(result.kind).toBe('product');
    expect(productsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.stringContaining('Shampoo') }),
    );
  });
});
