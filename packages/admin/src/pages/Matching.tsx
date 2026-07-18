import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matchingApi, sitesApi, toApiError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { useToast } from '../lib/toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Select } from '../components/ui/Field';
import type { MatchingPreview } from '../lib/types';
import { cn } from '../lib/utils';

type Tab = 'suggestions' | 'hub-missing' | 'site-orphans' | 'duplicates';

export function MatchingPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';
  const fileRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = (searchParams.get('tab') as Tab) || 'suggestions';
  const [siteId, setSiteId] = useState(searchParams.get('siteId') ?? '');
  const [preview, setPreview] = useState<MatchingPreview | null>(null);
  const [page, setPage] = useState(1);

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });

  const suggestionsQ = useQuery({
    queryKey: ['matching-suggestions', { siteId: siteId || undefined, page }],
    queryFn: () =>
      matchingApi.listSuggestions({
        siteId: siteId || undefined,
        status: 'PENDING_REVIEW',
        page,
        pageSize: 25,
      }),
    enabled: tab === 'suggestions',
  });

  const gapsQ = useQuery({
    queryKey: ['matching-gaps', { siteId: siteId || undefined, page }],
    queryFn: () =>
      matchingApi.getGaps({ siteId: siteId || undefined, page, pageSize: 25 }),
    enabled: tab === 'hub-missing' || tab === 'site-orphans',
  });

  const dupQ = useQuery({
    queryKey: ['matching-duplicates'],
    queryFn: () => matchingApi.getDuplicates(),
    enabled: tab === 'duplicates',
  });

  const analyzeMut = useMutation({
    mutationFn: ({ sid, file }: { sid: string; file: File }) => matchingApi.analyze(sid, file),
    onSuccess: (res) => {
      setPreview(res);
      toast.success(
        t('matching.analysisComplete'),
        t('matching.suggestionsCount', { count: res.suggestedCount + res.reviewCount }),
      );
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
      qc.invalidateQueries({ queryKey: ['matching-gaps'] });
    },
    onError: (err) => toast.error(t('matching.analysisFailed'), toApiError(err).message),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => matchingApi.approve(id),
    onSuccess: () => {
      toast.success(t('matching.approved'));
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
      qc.invalidateQueries({ queryKey: ['matching-gaps'] });
    },
    onError: (err) => toast.error(t('matching.approveFailed'), toApiError(err).message),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => matchingApi.reject(id),
    onSuccess: () => {
      toast.success(t('matching.rejected'));
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
      qc.invalidateQueries({ queryKey: ['matching-gaps'] });
    },
    onError: (err) => toast.error(t('matching.rejectFailed'), toApiError(err).message),
  });

  const bulkMut = useMutation({
    mutationFn: () => matchingApi.bulkApprove(siteId || undefined),
    onSuccess: (res) => {
      toast.success(t('matching.bulkApproved', { count: res.approved }));
      qc.invalidateQueries({ queryKey: ['matching-suggestions'] });
      qc.invalidateQueries({ queryKey: ['matching-gaps'] });
    },
    onError: (err) => toast.error(t('matching.bulkApproveFailed'), toApiError(err).message),
  });

  function setTab(next: Tab) {
    setPage(1);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    if (siteId) params.set('siteId', siteId);
    setSearchParams(params);
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'suggestions', label: t('matching.tabs.suggestions') },
    { id: 'hub-missing', label: t('matching.tabs.hubMissing') },
    { id: 'site-orphans', label: t('matching.tabs.siteOrphans') },
    { id: 'duplicates', label: t('matching.tabs.duplicates') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('matching.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('matching.subtitle')}</p>
      </div>

      {isAdmin && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold text-slate-800">{t('matching.analyzeTitle')}</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Select
              label={t('matching.site')}
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="sm:min-w-[220px]"
            >
              <option value="">{t('matching.selectSite')}</option>
              {sitesQ.data?.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && siteId) analyzeMut.mutate({ sid: siteId, file: f });
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                loading={analyzeMut.isPending}
                disabled={!siteId}
                onClick={() => fileRef.current?.click()}
              >
                {t('matching.uploadAnalyze')}
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              loading={bulkMut.isPending}
              onClick={() => bulkMut.mutate()}
            >
              {t('matching.bulkApprove')}
            </Button>
          </div>
          {preview && (
            <p className="text-xs text-slate-600">
              {t('matching.lastRun', {
                suggested: preview.suggestedCount,
                review: preview.reviewCount,
                rejected: preview.rejectedCount,
                ai: preview.aiReviewCount,
              })}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'rounded-t-lg px-3 py-2 text-sm font-medium transition',
              tab === item.id
                ? 'border border-b-0 border-slate-200 bg-white text-brand-700'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t('matching.filterSite')}
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            setPage(1);
          }}
          className="sm:min-w-[220px]"
        >
          <option value="">{t('matching.allSites')}</option>
          {sitesQ.data?.data.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        {gapsQ.data && tab !== 'suggestions' && tab !== 'duplicates' && (
          <p className="text-xs text-slate-500">
            {tab === 'hub-missing'
              ? t('matching.gapsHubTotal', { count: gapsQ.data.summary.hubNotOnSiteTotal })
              : t('matching.gapsSiteTotal', { count: gapsQ.data.summary.siteNotInHubTotal })}
          </p>
        )}
      </div>

      {tab === 'suggestions' && (
        <SuggestionsTable
          isAdmin={isAdmin}
          loading={suggestionsQ.isLoading}
          rows={suggestionsQ.data?.data ?? []}
          empty={t('matching.empty')}
          onApprove={(id) => approveMut.mutate(id)}
          onReject={(id) => rejectMut.mutate(id)}
          approvePending={approveMut.isPending}
          rejectPending={rejectMut.isPending}
        />
      )}

      {tab === 'hub-missing' && (
        <HubMissingTable
          loading={gapsQ.isLoading}
          rows={gapsQ.data?.hubNotOnSite.data ?? []}
          empty={t('matching.hubMissingEmpty')}
        />
      )}

      {tab === 'site-orphans' && (
        <SiteOrphansTable
          loading={gapsQ.isLoading}
          rows={gapsQ.data?.siteNotInHub.data ?? []}
          empty={t('matching.siteOrphansEmpty')}
        />
      )}

      {tab === 'duplicates' && (
        <DuplicatesPanel loading={dupQ.isLoading} data={dupQ.data} empty={t('matching.duplicatesEmpty')} />
      )}

      {tab === 'suggestions' && suggestionsQ.data && suggestionsQ.data.total > 25 && (
        <Pager page={page} total={suggestionsQ.data.total} onChange={setPage} />
      )}
      {(tab === 'hub-missing' || tab === 'site-orphans') &&
        gapsQ.data &&
        (tab === 'hub-missing'
          ? gapsQ.data.hubNotOnSite.total
          : gapsQ.data.siteNotInHub.total) > 25 && (
          <Pager
            page={page}
            total={
              tab === 'hub-missing'
                ? gapsQ.data.hubNotOnSite.total
                : gapsQ.data.siteNotInHub.total
            }
            onChange={setPage}
          />
        )}
    </div>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {t('common.prev')}
      </Button>
      <Button size="sm" variant="secondary" disabled={page * 25 >= total} onClick={() => onChange(page + 1)}>
        {t('common.next')}
      </Button>
    </div>
  );
}

function SuggestionsTable({
  isAdmin,
  loading,
  rows,
  empty,
  onApprove,
  onReject,
  approvePending,
  rejectPending,
}: {
  isAdmin: boolean;
  loading: boolean;
  rows: Array<{
    id: string;
    site: { name: string };
    siteSpecificTitle: string | null;
    product: { skuMaster: string; name: string };
    matchConfidence: number | null;
    matchAiReasoning: string | null;
  }>;
  empty: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  approvePending: boolean;
  rejectPending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('matching.site')}</th>
            <th>{t('matching.siteTitle')}</th>
            <th>{t('matching.hubSku')}</th>
            <th>{t('matching.hubName')}</th>
            <th>{t('matching.confidence')}</th>
            <th>{t('matching.aiReasoning')}</th>
            {isAdmin && <th>{t('products.actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={isAdmin ? 7 : 6} className="py-8 text-center">
                <Spinner className="mx-auto h-5 w-5" />
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.site.name}</td>
              <td className="max-w-[200px] truncate">{row.siteSpecificTitle ?? t('common.emDash')}</td>
              <td className="font-mono text-xs">{row.product.skuMaster}</td>
              <td className="max-w-[180px] truncate">{row.product.name}</td>
              <td>
                <Badge tone={row.matchConfidence && row.matchConfidence >= 90 ? 'green' : 'amber'}>
                  {row.matchConfidence?.toFixed(0) ?? t('common.emDash')}%
                </Badge>
              </td>
              <td className="max-w-[240px] truncate text-xs text-slate-500">
                {row.matchAiReasoning ?? t('common.emDash')}
              </td>
              {isAdmin && (
                <td className="space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="secondary" loading={approvePending} onClick={() => onApprove(row.id)}>
                    {t('matching.approve')}
                  </Button>
                  <Button size="sm" variant="ghost" loading={rejectPending} onClick={() => onReject(row.id)}>
                    {t('matching.reject')}
                  </Button>
                </td>
              )}
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 7 : 6} className="py-8 text-center text-slate-400">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HubMissingTable({
  loading,
  rows,
  empty,
}: {
  loading: boolean;
  rows: Array<{
    productId: string;
    skuMaster: string;
    name: string;
    siteName: string;
    reason: string;
  }>;
  empty: string;
}) {
  const { t } = useTranslation();
  const reasonLabel: Record<string, string> = {
    NO_MAPPING: t('matching.reasonNoMapping'),
    NOT_SYNCED: t('matching.reasonNotSynced'),
    PENDING_REVIEW: t('matching.reasonPending'),
  };
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('matching.site')}</th>
            <th>{t('matching.hubSku')}</th>
            <th>{t('matching.hubName')}</th>
            <th>{t('matching.gapReason')}</th>
            <th>{t('products.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={5} className="py-8 text-center">
                <Spinner className="mx-auto h-5 w-5" />
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={`${row.productId}-${row.siteName}`}>
              <td>{row.siteName}</td>
              <td className="font-mono text-xs">{row.skuMaster}</td>
              <td>{row.name}</td>
              <td>
                <Badge tone={row.reason === 'NO_MAPPING' ? 'red' : 'amber'}>
                  {reasonLabel[row.reason] ?? row.reason}
                </Badge>
              </td>
              <td>
                <Link to={`/products/${row.productId}`} className="btn-ghost px-3 py-1.5 text-xs">
                  {t('common.view')}
                </Link>
              </td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-slate-400">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SiteOrphansTable({
  loading,
  rows,
  empty,
}: {
  loading: boolean;
  rows: Array<{
    siteName: string;
    siteSku: string | null;
    siteTitle: string;
    source: string;
    orderCount?: number;
  }>;
  empty: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('matching.site')}</th>
            <th>{t('matching.siteTitle')}</th>
            <th>{t('matching.siteSku')}</th>
            <th>{t('matching.source')}</th>
            <th>{t('matching.orderHits')}</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={5} className="py-8 text-center">
                <Spinner className="mx-auto h-5 w-5" />
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={`${row.siteName}-${row.siteSku}-${i}`}>
              <td>{row.siteName}</td>
              <td>{row.siteTitle}</td>
              <td className="font-mono text-xs">{row.siteSku ?? t('common.emDash')}</td>
              <td>
                <Badge tone={row.source === 'ORDER' ? 'blue' : 'gray'}>
                  {row.source === 'ORDER' ? t('matching.sourceOrder') : t('matching.sourceUpload')}
                </Badge>
              </td>
              <td>{row.orderCount ?? t('common.emDash')}</td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-slate-400">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DuplicatesPanel({
  loading,
  data,
  empty,
}: {
  loading: boolean;
  data?: {
    siteSkuDuplicates: Array<{ siteName: string; siteSku: string; count: number; productIds: string[] }>;
    siteProductIdDuplicates: Array<{
      siteName: string;
      siteProductId: string;
      count: number;
      productIds: string[];
    }>;
    hubBarcodeDuplicates: Array<{ barcode: string; skus: string[] }>;
    total: number;
  };
  empty: string;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!data || data.total === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>;
  }
  return (
    <div className="space-y-4">
      {data.siteSkuDuplicates.map((d) => (
        <div key={`${d.siteName}-${d.siteSku}`} className="card p-4 text-sm">
          <Badge tone="red" className="mb-2">
            {t('matching.duplicateSiteSku')}
          </Badge>
          <p>
            {t('matching.duplicateSiteSkuRow', {
              site: d.siteName,
              sku: d.siteSku,
              count: d.count,
            })}
          </p>
        </div>
      ))}
      {data.siteProductIdDuplicates.map((d) => (
        <div key={`${d.siteName}-${d.siteProductId}`} className="card p-4 text-sm">
          <Badge tone="red" className="mb-2">
            {t('matching.duplicateSiteProductId')}
          </Badge>
          <p>
            {t('matching.duplicateSiteProductIdRow', {
              site: d.siteName,
              id: d.siteProductId,
              count: d.count,
            })}
          </p>
        </div>
      ))}
      {data.hubBarcodeDuplicates.map((d) => (
        <div key={d.barcode} className="card p-4 text-sm">
          <Badge tone="amber" className="mb-2">
            {t('matching.duplicateHubBarcode')}
          </Badge>
          <p>{t('matching.duplicateHubBarcodeRow', { barcode: d.barcode, skus: d.skus.join(', ') })}</p>
        </div>
      ))}
    </div>
  );
}
