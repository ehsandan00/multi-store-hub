import { productsApi } from './api';
import { pickOcrSearchQueries } from './ocr';
import type { ProductRow } from './types';

export type ScanSource = 'barcode' | 'ocr';

export type ProductScanResult =
  | { kind: 'product'; product: ProductRow }
  | { kind: 'many'; query: string; count: number }
  | { kind: 'none'; query: string };

export async function resolveProductScan(
  value: string,
  source: ScanSource,
): Promise<ProductScanResult> {
  const trimmed = value.trim();
  if (!trimmed) return { kind: 'none', query: '' };

  if (source === 'barcode') {
    try {
      const product = await productsApi.lookup(trimmed);
      return { kind: 'product', product };
    } catch {
      return { kind: 'none', query: trimmed };
    }
  }

  for (const query of pickOcrSearchQueries(trimmed)) {
    const page = await productsApi.list({ search: query, pageSize: 10, view: 'hub' });
    if (page.data.length === 1) return { kind: 'product', product: page.data[0]! };
    if (page.data.length > 1) return { kind: 'many', query, count: page.data.length };
  }

  const fallback = pickOcrSearchQueries(trimmed)[0] ?? trimmed.slice(0, 80);
  return { kind: 'none', query: fallback };
}
