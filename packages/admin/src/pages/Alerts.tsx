import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, matchingApi, toApiError } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { isoDateLocal } from '../lib/barcode';
import { getAlertBreakdown } from '../lib/alert-breakdown';

export function AlertsPage() {
  const { t } = useTranslation();
  const today = isoDateLocal();

  const summaryQ = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => dashboardApi.summary(),
    staleTime: 30_000,
  });

  const dupQ = useQuery({
    queryKey: ['matching', 'duplicates'],
    queryFn: () => matchingApi.getDuplicates(),
    staleTime: 60_000,
  });

  const b = getAlertBreakdown(summaryQ.data);

  const rows = [
    {
      key: 'lowStock',
      count: b.lowStock,
      label: t('alerts.lowStock'),
      desc: t('alerts.lowStockDesc'),
      to: '/products?lowStock=1',
      tone: 'amber' as const,
    },
    {
      key: 'expiringSoon',
      count: b.expiringSoon,
      label: t('alerts.expiringSoon'),
      desc: t('alerts.expiringSoonDesc'),
      to: '/reports?tab=expiry',
      tone: 'amber' as const,
    },
    {
      key: 'failedSyncs',
      count: b.failedSyncs,
      label: t('alerts.failedSyncs'),
      desc: t('alerts.failedSyncsDesc'),
      to: '/sync',
      tone: 'red' as const,
    },
    {
      key: 'pendingMappingReviews',
      count: b.pendingMappingReviews,
      label: t('alerts.pendingMapping'),
      desc: t('alerts.pendingMappingDesc'),
      to: '/matching?tab=suggestions',
      tone: 'blue' as const,
    },
    {
      key: 'duplicateOnSite',
      count: b.duplicateOnSite,
      label: t('alerts.duplicateOnSite'),
      desc: t('alerts.duplicateOnSiteDesc'),
      to: '/matching?tab=duplicates',
      tone: 'red' as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('alerts.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('alerts.subtitle')}</p>
      </div>

      {summaryQ.isLoading && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6" />
        </div>
      )}

      {summaryQ.isError && (
        <Card className="p-4 text-sm text-rose-600">
          {toApiError(summaryQ.error).message}
        </Card>
      )}

      {summaryQ.data && (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">{t('alerts.totalActive')}</p>
                <p className="text-3xl font-semibold text-slate-900">{b.total}</p>
              </div>
              <p className="max-w-md text-xs text-slate-500">{t('alerts.totalFormula')}</p>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <Link
                key={row.key}
                to={row.to}
                className="card block p-4 transition hover:border-brand-200 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{row.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.desc}</p>
                  </div>
                  <Badge tone={row.count > 0 ? row.tone : 'gray'}>{row.count}</Badge>
                </div>
              </Link>
            ))}
          </div>

          {(dupQ.data?.hubBarcodeDuplicates.length ?? 0) > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-slate-900">{t('alerts.hubBarcodeDupes')}</h2>
              <p className="mt-1 text-xs text-slate-500">{t('alerts.hubBarcodeDupesDesc')}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {dupQ.data?.hubBarcodeDuplicates.map((d) => (
                  <li key={d.barcode} className="rounded-lg bg-rose-50 px-3 py-2 text-rose-900">
                    {t('alerts.barcodeDuplicateRow', { barcode: d.barcode, skus: d.skus.join(', ') })}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-4 text-xs text-slate-500">
            {t('alerts.ordersTodayHint', { date: today })}
          </Card>
        </>
      )}
    </div>
  );
}
