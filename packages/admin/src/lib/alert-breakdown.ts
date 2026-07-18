import type { DashboardSummary } from './types';

export interface AlertBreakdown {
  lowStock: number;
  expiringSoon: number;
  failedSyncs: number;
  pendingMappingReviews: number;
  duplicateOnSite: number;
  total: number;
}

/** Normalize alert counts from API — supports older backends without full breakdown fields. */
export function getAlertBreakdown(summary: DashboardSummary | undefined): AlertBreakdown {
  if (!summary) {
    return {
      lowStock: 0,
      expiringSoon: 0,
      failedSyncs: 0,
      pendingMappingReviews: 0,
      duplicateOnSite: 0,
      total: 0,
    };
  }

  const k = summary.kpis;
  const b = summary.alertBreakdown;

  const lowStock = k.lowStockCount ?? b?.lowStock ?? 0;
  const expiringSoon = k.expiringSoonCount ?? b?.expiringSoon ?? 0;
  const pendingMappingReviews =
    k.pendingMappingReviews ?? b?.pendingMappingReviews ?? 0;
  const duplicateOnSite = k.duplicateOnSiteCount ?? b?.duplicateOnSite ?? 0;

  const knownWithoutSync =
    lowStock + expiringSoon + pendingMappingReviews + duplicateOnSite;

  let failedSyncs: number;
  if (typeof k.failedSyncCount === 'number') {
    failedSyncs = k.failedSyncCount;
  } else if (typeof b?.failedSyncs === 'number' && b.failedSyncs > 0) {
    failedSyncs = b.failedSyncs;
  } else {
    failedSyncs = Math.max(0, (k.activeAlerts ?? 0) - knownWithoutSync);
  }

  const partsSum = knownWithoutSync + failedSyncs;
  const total = k.activeAlerts ?? partsSum;

  return {
    lowStock,
    expiringSoon,
    failedSyncs,
    pendingMappingReviews,
    duplicateOnSite,
    total,
  };
}
