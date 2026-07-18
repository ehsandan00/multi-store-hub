import { describe, expect, it } from 'vitest';
import { SCAN_REGION, scanRegionStyle } from '../src/lib/scan-region';

describe('scanRegionStyle', () => {
  it('maps fractions to CSS percentages', () => {
    expect(scanRegionStyle(SCAN_REGION)).toEqual({
      left: '12.5%',
      top: '30%',
      width: '75%',
      height: '40%',
    });
  });
});
