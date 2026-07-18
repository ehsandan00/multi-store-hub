import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { matchingApi, sitesApi, toApiError } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Select } from '../components/ui/Field';
import { formatDateTime } from '../lib/utils';
import type { CompareLinkStatus } from '../lib/types';

type Filter = 'all' | 'linked' | 'hub_only' | 'site_only' | 'pending';

const STATUS_TONE: Record<CompareLinkStatus, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = {
  LINKED: 'green',
  NO_MAPPING: 'amber',
  PENDING: 'amber',
  NOT_SYNCED: 'red',
  SITE_ONLY: 'blue',
};

export function ComparePage() {
  const { t } = useTranslation();
  const [siteId, setSiteId] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });

  const compareQ = useQuery({
    queryKey: ['compare', siteId, filter, page],
    queryFn: () =>
      matchingApi.compare({ siteId, filter, page, pageSize: 50 }),
    enabled: !!siteId,
  });

  const summary = compareQ.data?.summary;
  const totalPages = compareQ.data
    ? Math.max(1, Math.ceil(compareQ.data.total / compareQ.data.pageSize))
    : 1;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('compare.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('compare.subtitle')}</p>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Select
          label={t('orders.site')}
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            setPage(1);
          }}
          className="min-w-[220px]"
        >
          <option value="">{t('compare.selectSite')}</option>
          {sitesQ.data?.data.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          label={t('compare.filter')}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setPage(1);
          }}
          className="min-w-[180px]"
        >
          <option value="all">{t('compare.filterAll')}</option>
          <option value="linked">{t('compare.filterLinked')}</option>
          <option value="hub_only">{t('compare.filterHubOnly')}</option>
          <option value="site_only">{t('compare.filterSiteOnly')}</option>
          <option value="pending">{t('compare.filterPending')}</option>
        </Select>
      </div>

      {!siteId && (
        <div className="card p-8 text-center text-sm text-slate-400">{t('compare.pickSite')}</div>
      )}

      {siteId && compareQ.isLoading && (
        <div className="card flex justify-center p-8">
          <Spinner className="h-6 w-6" />
        </div>
      )}

      {siteId && compareQ.isError && (
        <div className="card p-4 text-sm text-rose-600">
          {t('compare.loadFailed', { message: toApiError(compareQ.error).message })}
        </div>
      )}

      {siteId && compareQ.data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('compare.hubTotal')} value={summary?.hubTotal ?? 0} />
            <Stat label={t('compare.linked')} value={summary?.linked ?? 0} tone="green" />
            <Stat label={t('compare.hubOnly')} value={summary?.hubOnly ?? 0} tone="amber" />
            <Stat label={t('compare.siteOnly')} value={summary?.siteOnly ?? 0} tone="blue" />
          </div>

          <div className="table-wrap">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('compare.status')}</th>
                  <th>{t('compare.hubSku')}</th>
                  <th>{t('compare.hubName')}</th>
                  <th>{t('compare.hubPrice')}</th>
                  <th>{t('compare.hubStock')}</th>
                  <th>{t('compare.type')}</th>
                  <th>{t('compare.siteSku')}</th>
                  <th>{t('compare.siteTitle')}</th>
                  <th>{t('compare.siteId')}</th>
                  <th>{t('compare.lastSync')}</th>
                </tr>
              </thead>
              <tbody>
                {compareQ.data.data.map((row, i) => (
                  <tr key={`${row.kind}-${row.hubSku ?? row.siteSku ?? i}`}>
                    <td>
                      <Badge tone={STATUS_TONE[row.linkStatus]}>
                        {t(`compare.linkStatus.${row.linkStatus}`, row.linkStatus)}
                      </Badge>
                    </td>
                    <td className="font-mono text-xs">
                      {row.productId ? (
                        <Link to={`/products/${row.productId}`} className="text-brand-600 hover:underline">
                          {row.hubSku ?? t('common.emDash')}
                        </Link>
                      ) : (
                        row.hubSku ?? t('common.emDash')
                      )}
                    </td>
                    <td>{row.hubName ?? t('common.emDash')}</td>
                    <td>{row.hubPrice ?? t('common.emDash')}</td>
                    <td>{row.hubStock ?? t('common.emDash')}</td>
                    <td>
                      {row.productType ? (
                        <Badge tone="gray">{row.productType}</Badge>
                      ) : (
                        t('common.emDash')
                      )}
                    </td>
                    <td className="font-mono text-xs">{row.siteSku ?? t('common.emDash')}</td>
                    <td>{row.siteTitle ?? t('common.emDash')}</td>
                    <td className="font-mono text-xs">{row.siteProductId ?? t('common.emDash')}</td>
                    <td className="text-xs text-slate-500">
                      {row.lastSyncedAt ? formatDateTime(row.lastSyncedAt) : t('common.emDash')}
                    </td>
                  </tr>
                ))}
                {compareQ.data.data.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      {t('compare.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {t('common.pageOf', { page, totalPages })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('common.prev')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('common.next')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'amber' | 'blue';
}) {
  const colors =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'blue'
          ? 'text-sky-700'
          : 'text-slate-900';
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${colors}`}>{value}</p>
    </div>
  );
}
