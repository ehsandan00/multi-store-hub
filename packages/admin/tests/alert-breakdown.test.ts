import { describe, it, expect } from 'vitest';
import { getAlertBreakdown } from '../src/lib/alert-breakdown';
import type { DashboardSummary } from '../src/lib/types';

const base: DashboardSummary = {
  kpis: {
    totalProducts: 0,
    lowStockCount: 2,
    totalSites: 0,
    activeSites: 0,
    totalOrders: 0,
    ordersLast30d: 0,
    inventoryUnits: 0,
    inventoryValue: '0',
    ordersToday: 0,
    revenueToday: '0',
    expiringSoonCount: 0,
    pendingMappingReviews: 0,
    activeAlerts: 16,
  },
  alertBreakdown: {
    lowStock: 0,
    expiringSoon: 0,
    failedSyncs: 0,
    pendingMappingReviews: 0,
    duplicateOnSite: 0,
  },
  revenueSeries: [],
  statusBreakdown: [],
  topProducts: [],
  lowStockProducts: [],
  expiringSoonProducts: [],
  latestSyncs: [],
  recentOrders: [],
  since: '',
};

describe('getAlertBreakdown', () => {
  it('derives failed syncs from activeAlerts when not returned by API', () => {
    const b = getAlertBreakdown(base);
    expect(b.lowStock).toBe(2);
    expect(b.failedSyncs).toBe(14);
    expect(b.total).toBe(16);
  });

  it('uses explicit kpis fields when present', () => {
    const b = getAlertBreakdown({
      ...base,
      kpis: {
        ...base.kpis,
        activeAlerts: 6,
        lowStockCount: 2,
        expiringSoonCount: 2,
        failedSyncCount: 1,
        pendingMappingReviews: 1,
        duplicateOnSiteCount: 0,
      },
    });
    expect(b.lowStock).toBe(2);
    expect(b.expiringSoon).toBe(2);
    expect(b.failedSyncs).toBe(1);
    expect(b.pendingMappingReviews).toBe(1);
    expect(b.total).toBe(6);
  });
});
