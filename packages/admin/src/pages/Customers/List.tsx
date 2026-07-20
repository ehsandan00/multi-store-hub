import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi, sitesApi, syncApi, toApiError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../lib/toast';
import { formatDateTime } from '../../lib/utils';
import type { ListCustomersQuery } from '../../lib/types';

type Tab = 'list' | 'duplicates';

export function CustomersList() {
  const { t } = useTranslation();
  const { hasRole } = useAuthStore();
  const canPull = hasRole('ADMIN', 'WAREHOUSE_STAFF');
  const toast = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as Tab) || 'list';

  const [siteId, setSiteId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
    staleTime: 60_000,
  });

  const sites = sitesQ.data?.data ?? [];
  const selectedSite = sites.find((s) => s.id === siteId);

  useEffect(() => {
    if (!siteId && sites.length > 0) {
      setSiteId(sites[0].id);
    }
  }, [siteId, sites]);

  const listQuery: ListCustomersQuery = useMemo(
    () => ({
      siteId,
      search: search.trim() || undefined,
      page,
      pageSize,
      sortBy: 'totalSpent',
      sortDir: 'desc',
    }),
    [siteId, search, page, pageSize],
  );

  const listQ = useQuery({
    queryKey: ['customers', listQuery],
    queryFn: () => customersApi.list(listQuery),
    enabled: tab === 'list' && !!siteId,
    placeholderData: (prev) => prev,
  });

  const dupQ = useQuery({
    queryKey: ['customers', 'cross-site-duplicates'],
    queryFn: () => customersApi.crossSiteDuplicates(),
    staleTime: 60_000,
  });

  const pullM = useMutation({
    mutationFn: (id: string) => syncApi.pullCustomers(id),
    onSuccess: () => {
      toast.success(t('customers.pullQueued'));
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['sync'] });
    },
    onError: (err) => toast.error(toApiError(err).message),
  });

  function setTab(next: Tab) {
    setSearchParams(next === 'list' ? {} : { tab: next });
  }

  const total = listQ.data?.total ?? 0;
  const totalPages = listQ.data?.totalPages ?? 1;
  const isWoo = selectedSite?.platform === 'WOOCOMMERCE';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('customers.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('customers.subtitle')}</p>
        </div>
        {tab === 'list' && siteId && canPull && (
          <Button
            type="button"
            disabled={!isWoo || pullM.isPending}
            title={!isWoo ? t('customers.pullNotSupported') : undefined}
            onClick={() => pullM.mutate(siteId)}
          >
            {pullM.isPending ? t('common.loading') : t('customers.pullCustomers')}
          </Button>
        )}
      </div>

      {(dupQ.data?.totalGroups ?? 0) > 0 && tab === 'list' && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>{t('customers.duplicateBanner', { count: dupQ.data?.totalGroups ?? 0 })}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setTab('duplicates')}>
            {t('customers.viewDuplicates')}
          </Button>
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <TabButton active={tab === 'list'} onClick={() => setTab('list')}>
          {t('customers.tabs.list')}
        </TabButton>
        <TabButton active={tab === 'duplicates'} onClick={() => setTab('duplicates')}>
          {t('customers.tabs.duplicates')}
          {(dupQ.data?.totalGroups ?? 0) > 0 && (
            <Badge tone="amber" className="ms-2">
              {dupQ.data?.totalGroups}
            </Badge>
          )}
        </TabButton>
      </div>

      {tab === 'list' && (
        <>
          {sites.length === 0 && !sitesQ.isLoading ? (
            <div className="card p-6 text-sm text-slate-500">{t('customers.noSites')}</div>
          ) : (
            <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="label">{t('customers.siteRequired')}</label>
                <select
                  className="input"
                  value={siteId}
                  onChange={(e) => {
                    setSiteId(e.target.value);
                    setPage(1);
                  }}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                id="customers-search"
                label={t('products.search')}
                placeholder={t('customers.searchPlaceholder')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          )}

          {listQ.isError && (
            <div className="card p-4 text-sm text-rose-600">
              {t('customers.loadFailed', { message: toApiError(listQ.error).message })}
            </div>
          )}

          <div className="card overflow-x-auto">
            {listQ.isLoading ? (
              <div className="flex justify-center p-8">
                <Spinner className="h-6 w-6" />
              </div>
            ) : (listQ.data?.data.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-slate-500">{t('customers.empty')}</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('customers.name')}</th>
                    <th>{t('customers.email')}</th>
                    <th>{t('customers.phone')}</th>
                    <th>{t('customers.orders')}</th>
                    <th>{t('customers.totalSpent')}</th>
                    <th>{t('customers.remoteId')}</th>
                    <th>{t('customers.created')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQ.data?.data ?? []).map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="font-medium text-slate-900">{c.name}</span>
                        {c.crossSiteDuplicate && (
                          <Badge tone="amber" className="ms-2">
                            {t('customers.crossSiteBadge')}
                          </Badge>
                        )}
                      </td>
                      <td>{c.email ?? t('common.emDash')}</td>
                      <td>{c.phone ?? t('common.emDash')}</td>
                      <td>{c.totalOrdersCount}</td>
                      <td>{c.totalSpent}</td>
                      <td>{c.remoteCustomerId ?? t('common.emDash')}</td>
                      <td className="whitespace-nowrap text-slate-500">
                        {formatDateTime(c.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">
                {t('common.showingRange', {
                  from: (page - 1) * pageSize + 1,
                  to: Math.min(page * pageSize, total),
                  total,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t('common.prev')}
                </Button>
                <Button
                  type="button"
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

      {tab === 'duplicates' && (
        <div className="space-y-3">
          {dupQ.isLoading ? (
            <div className="flex justify-center p-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : (dupQ.data?.groups.length ?? 0) === 0 ? (
            <div className="card p-6 text-sm text-slate-500">{t('customers.duplicatesEmpty')}</div>
          ) : (
            dupQ.data?.groups.map((g) => (
              <div key={`${g.matchType}-${g.matchKey}`} className="card p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="amber">{t(`customers.matchType.${g.matchType}`)}</Badge>
                  <span className="text-sm font-medium text-slate-900">{g.matchKey}</span>
                </div>
                <ul className="space-y-2">
                  {g.customers.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-800">{c.name}</span>
                      <Badge tone="blue">{c.siteName ?? c.siteId}</Badge>
                      <span className="text-slate-500">
                        {[c.email, c.phone].filter(Boolean).join(' · ') || t('common.emDash')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}
