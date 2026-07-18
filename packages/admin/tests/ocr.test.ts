import { describe, expect, it } from 'vitest';
import { pickOcrSearchQueries } from '../src/lib/ocr';

describe('pickOcrSearchQueries', () => {
  it('prefers longer text lines with letters', () => {
    const queries = pickOcrSearchQueries('123\nشامپو ضد ریزش\nABC\n12/2026');
    expect(queries[0]).toBe('شامپو ضد ریزش');
  });

  it('drops number-only lines', () => {
    const queries = pickOcrSearchQueries('1234567890\n2026-01-01');
    expect(queries).toHaveLength(0);
  });

  it('includes collapsed full text as a fallback query', () => {
    const queries = pickOcrSearchQueries('  Vitamin C Serum  \n  500 mg  ');
    expect(queries.some((q) => q.includes('Vitamin C Serum'))).toBe(true);
  });
});
