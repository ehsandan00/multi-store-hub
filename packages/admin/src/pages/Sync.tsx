import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { syncApi, sitesApi, toApiError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { useToast } from '../lib/toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatDateTime } from '../lib/utils';
import type { SafeSite, SyncJob, SyncJobStatus, SyncLogRow, SyncScope } from '../lib/types';

export function SyncPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();
  const canMutate = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';
  const canSchedule = user?.role === 'ADMIN';
  const isAdmin = user?.role === 'ADMIN';

  const [pushTarget, setPushTarget] = useState<SafeSite | null>(null);
  const [pushScope, setPushScope] = useState<SyncScope>('ALL');
  const [pullTarget, setPullTarget] = useState<SafeSite | null>(null);
  const [deleteLogTarget, setDeleteLogTarget] = useState<SyncLogRow | null>(null);
  const [clearFailedOpen, setClearFailedOpen] = useState(false);

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });
  const jobsQ = useQuery({
    queryKey: ['sync-jobs', { page: 1, pageSize: 25 }],
    queryFn: () => syncApi.listJobs({ page: 1, pageSize: 25 }),
    refetchInterval: 5_000,
  });
  const logsQ = useQuery({
    queryKey: ['sync-logs', { page: 1, pageSize: 25 }],
    queryFn: () => syncApi.listLogs({ page: 1, pageSize: 25 }),
  });

  const pushMut = useMutation({
    mutationFn: ({ siteId, scope }: { siteId: string; scope: SyncScope }) =>
      syncApi.push(siteId, { scope }),
    onSuccess: (res: { id: string; status: SyncJobStatus; queued: boolean }) => {
      toast.success(t('sync.syncQueued'), `Job ${res.id}`);
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      setPushTarget(null);
    },
    onError: (err) => toast.error(t('sync.queueSyncFailed'), toApiError(err).message),
  });

  const previewAspNetMut = useMutation({
    mutationFn: (site: SafeSite) => syncApi.previewAspNet(site.id, { scope: 'PRICE_STOCK' }),
    onSuccess: (report, site) => {
      toast.success(
        t('sync.aspNetPreviewReady'),
        t('sync.aspNetPreviewSummary', {
          matched: report.matched,
          unresolved: report.unresolved,
          duplicate: report.duplicate,
        }),
      );
      setPushScope('PRICE_STOCK');
      setPushTarget(site);
    },
    onError: (err) => toast.error(t('sync.aspNetPreviewFailed'), toApiError(err).message),
  });

  const importMappingsMut = useMutation({
    mutationFn: async ({ siteId, file }: { siteId: string; file: File }) => {
      const text = await file.text();
      const rows = text
        .split(/\r?\n/)
        .map((line) => line.split('\t'))
        .filter((columns) => columns.length >= 2)
        .map(([sourceProductId, sku]) => ({
          sourceProductId: Number(sourceProductId.trim()),
          sourceKind: 'PRODUCT' as const,
          sku: sku.trim(),
        }))
        .filter(
          (row) => Number.isInteger(row.sourceProductId) && row.sourceProductId > 0 && row.sku,
        );
      return syncApi.importAspNetMappings(siteId, rows);
    },
    onSuccess: (result) => {
      toast.success(t('sync.mappingImportComplete'), t('sync.mappingImportSummary', result));
    },
    onError: (err) => toast.error(t('sync.mappingImportFailed'), toApiError(err).message),
  });

  const pullMut = useMutation({
    mutationFn: (siteId: string) => syncApi.pull(siteId),
    onSuccess: (res: { id: string; status: SyncJobStatus; queued: boolean }) => {
      toast.success(t('sync.pullQueued'), `Job ${res.id}`);
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      qc.invalidateQueries({ queryKey: ['sites'] });
      setPullTarget(null);
    },
    onError: (err) => toast.error(t('sync.queuePullFailed'), toApiError(err).message),
  });

  const scheduleMut = useMutation({
    mutationFn: ({
      siteId,
      payload,
    }: {
      siteId: string;
      payload: { syncEnabled?: boolean; syncIntervalMs?: number; orderPullEnabled?: boolean };
    }) => syncApi.updateSchedule(siteId, payload),
    onSuccess: () => {
      toast.success(t('sync.scheduleUpdated'));
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast.error(t('sync.scheduleUpdateFailed'), toApiError(err).message),
  });

  const deleteLogMut = useMutation({
    mutationFn: (id: string) => syncApi.deleteLog(id),
    onSuccess: () => {
      toast.success(t('sync.logDeleted'));
      setDeleteLogTarget(null);
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
    onError: (err) => toast.error(t('sync.logDeleteFailed'), toApiError(err).message),
  });

  const clearFailedMut = useMutation({
    mutationFn: () => syncApi.clearFailedLogs(),
    onSuccess: (res) => {
      toast.success(t('sync.failedLogsCleared', { count: res.deleted }));
      setClearFailedOpen(false);
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
    onError: (err) => toast.error(t('sync.clearFailedFailed'), toApiError(err).message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('sync.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('sync.subtitle')} {!canMutate && t('common.readOnly')}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('sync.sites')}
        </h2>
        {sitesQ.isLoading && (
          <div className="card flex justify-center p-6">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {sitesQ.isError && (
          <div className="card p-4 text-sm text-rose-600">
            {t('sync.loadSitesFailed', { message: toApiError(sitesQ.error).message })}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sitesQ.data?.data.map((s) => (
            <SiteSyncCard
              key={s.id}
              site={s}
              canMutate={canMutate}
              canSchedule={canSchedule}
              lastJob={latestJobForSite(jobsQ.data?.data ?? [], s.id)}
              onPush={() => {
                setPushScope(s.platform === 'NOPCOMMERCE_ASPNET' ? 'PRICE_STOCK' : 'ALL');
                setPushTarget(s);
              }}
              onPreview={() => previewAspNetMut.mutate(s)}
              onImportMappings={(file) => importMappingsMut.mutate({ siteId: s.id, file })}
              onPull={() => setPullTarget(s)}
              onToggleSchedule={(enabled) =>
                scheduleMut.mutate({ siteId: s.id, payload: { syncEnabled: enabled } })
              }
              onToggleOrderPull={(enabled) =>
                scheduleMut.mutate({ siteId: s.id, payload: { orderPullEnabled: enabled } })
              }
              onIntervalChange={(ms) =>
                scheduleMut.mutate({ siteId: s.id, payload: { syncIntervalMs: ms } })
              }
              scheduleLoading={scheduleMut.isPending}
              previewLoading={previewAspNetMut.isPending}
              mappingImportLoading={importMappingsMut.isPending}
            />
          ))}
          {sitesQ.data && sitesQ.data.data.length === 0 && (
            <div className="card col-span-full p-6 text-center text-sm text-slate-400">
              {t('sync.noSitesHint')}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('sync.recentJobs')}
        </h2>
        <div className="table-wrap hidden md:block">
          <table className="table">
            <thead>
              <tr>
                <th>{t('orders.site')}</th>
                <th>{t('sync.dir')}</th>
                <th>{t('sync.scope')}</th>
                <th>{t('orders.status')}</th>
                <th>{t('sync.pushedPulled')}</th>
                <th>{t('sync.createdUpdated')}</th>
                <th>{t('sync.failed')}</th>
                <th>{t('sync.started')}</th>
                <th>{t('sync.finished')}</th>
              </tr>
            </thead>
            <tbody>
              {jobsQ.isLoading && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {jobsQ.data?.data.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
              {jobsQ.data && jobsQ.data.data.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    {t('sync.noJobsHint')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-3 md:hidden">
          {jobsQ.data?.data.map((j) => (
            <JobMobileCard key={j.id} job={j} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('sync.syncLog')}
          </h2>
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setClearFailedOpen(true)}
            >
              {t('sync.clearFailedLogs')}
            </Button>
          )}
        </div>
        <div className="table-wrap hidden md:block">
          <table className="table">
            <thead>
              <tr>
                <th>{t('orders.site')}</th>
                <th>{t('reports.type')}</th>
                <th>{t('orders.status')}</th>
                <th>{t('sync.time')}</th>
                {isAdmin && <th className="text-end">{t('products.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {logsQ.isLoading && (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="py-6 text-center text-slate-400">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {logsQ.data?.data.map((l) => (
                <LogRow
                  key={l.id}
                  log={l}
                  canDelete={isAdmin}
                  onDelete={() => setDeleteLogTarget(l)}
                />
              ))}
              {logsQ.data && logsQ.data.data.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="py-6 text-center text-slate-400">
                    {t('sync.noLogsHint')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={!!pushTarget}
        title={t('sync.pushDialogTitle', { name: pushTarget?.name ?? '' })}
        message={
          pushTarget?.platform === 'NOPCOMMERCE_ASPNET'
            ? t('sync.aspNetPushDialogMessage')
            : t('sync.pushDialogMessage')
        }
        confirmLabel={t('sync.queuePush')}
        cancelLabel={t('common.cancel')}
        loading={pushMut.isPending}
        onConfirm={() => pushTarget && pushMut.mutate({ siteId: pushTarget.id, scope: pushScope })}
        onCancel={() => setPushTarget(null)}
      />

      <ConfirmDialog
        open={!!pullTarget}
        title={t('sync.pullDialogTitle', { name: pullTarget?.name ?? '' })}
        message={t('sync.pullDialogMessage', {
          firstTime: !pullTarget?.lastOrderPullAt ? t('sync.firstTimeAll') : '',
        })}
        confirmLabel={t('sync.queuePull')}
        cancelLabel={t('common.cancel')}
        loading={pullMut.isPending}
        onConfirm={() => pullTarget && pullMut.mutate(pullTarget.id)}
        onCancel={() => setPullTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteLogTarget}
        title={t('sync.deleteLogTitle')}
        message={t('sync.deleteLogMessage', {
          site: deleteLogTarget?.site?.name ?? '',
          status: deleteLogTarget?.status ?? '',
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleteLogMut.isPending}
        onConfirm={() => deleteLogTarget && deleteLogMut.mutate(deleteLogTarget.id)}
        onCancel={() => setDeleteLogTarget(null)}
      />

      <ConfirmDialog
        open={clearFailedOpen}
        title={t('sync.clearFailedTitle')}
        message={t('sync.clearFailedMessage')}
        confirmLabel={t('sync.clearFailedConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={clearFailedMut.isPending}
        onConfirm={() => clearFailedMut.mutate()}
        onCancel={() => setClearFailedOpen(false)}
      />
    </div>
  );
}

function latestJobForSite(jobs: SyncJob[], siteId: string): SyncJob | undefined {
  return jobs.find((j) => j.siteId === siteId);
}

function DirectionBadge({ direction }: { direction: SyncJob['direction'] }) {
  const { t } = useTranslation();
  const isPull = direction === 'PULL';
  return (
    <Badge tone={isPull ? 'blue' : 'gray'}>{t(`syncDirection.${direction}`, direction)}</Badge>
  );
}

function SiteSyncCard({
  site,
  canMutate,
  canSchedule,
  lastJob,
  onPush,
  onPull,
  onPreview,
  onImportMappings,
  onToggleSchedule,
  onToggleOrderPull,
  onIntervalChange,
  scheduleLoading,
  previewLoading,
  mappingImportLoading,
}: {
  site: SafeSite;
  canMutate: boolean;
  canSchedule: boolean;
  lastJob?: SyncJob;
  onPush: () => void;
  onPull: () => void;
  onPreview: () => void;
  onImportMappings: (file: File) => void;
  onToggleSchedule: (enabled: boolean) => void;
  onToggleOrderPull: (enabled: boolean) => void;
  onIntervalChange: (ms: number) => void;
  scheduleLoading: boolean;
  previewLoading: boolean;
  mappingImportLoading: boolean;
}) {
  const { t } = useTranslation();
  const intervalMin = Math.round(site.syncIntervalMs / 60_000);

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{site.name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{site.baseUrl}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Badge tone={site.platform === 'NOPCOMMERCE_ASPNET' ? 'amber' : 'gray'}>
            {site.platform === 'NOPCOMMERCE_ASPNET' ? 'ASP.NET' : 'WooCommerce'}
          </Badge>
          {site.networkRoute === 'DIRECT' ? (
            <Badge tone="green">{t('sync.direct')}</Badge>
          ) : (
            <Badge tone="blue">{t('sync.proxy')}</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('sync.lastPush')}</p>
          <p>{site.lastSyncAt ? formatDateTime(site.lastSyncAt) : t('common.never')}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('sync.lastPull')}</p>
          <p>{site.lastOrderPullAt ? formatDateTime(site.lastOrderPullAt) : t('common.never')}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            {t('sync.latestJob')}
          </p>
          <p className="flex items-center gap-1.5">
            {lastJob ? (
              <>
                <DirectionBadge direction={lastJob.direction} />
                <StatusBadge status={lastJob.status} />
              </>
            ) : (
              <span className="text-slate-400">{t('common.emDash')}</span>
            )}
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-700">{t('sync.scheduledPush')}</span>
          {canSchedule ? (
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="text-brand-600 focus:ring-brand-500 h-4 w-4 rounded border-slate-300"
                checked={site.syncEnabled}
                disabled={scheduleLoading}
                onChange={(e) => onToggleSchedule(e.target.checked)}
              />
              <span className={site.syncEnabled ? 'text-emerald-700' : 'text-slate-500'}>
                {site.syncEnabled ? t('common.on') : t('common.off')}
              </span>
            </label>
          ) : (
            <Badge tone={site.syncEnabled ? 'green' : 'gray'}>
              {site.syncEnabled ? t('common.enabled') : t('common.disabled')}
            </Badge>
          )}
        </div>
      </div>

      {site.platform !== 'NOPCOMMERCE_ASPNET' && (
        <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700">{t('sync.scheduledPull')}</span>
            {canSchedule ? (
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="text-brand-600 focus:ring-brand-500 h-4 w-4 rounded border-slate-300"
                  checked={site.orderPullEnabled}
                  disabled={scheduleLoading}
                  onChange={(e) => onToggleOrderPull(e.target.checked)}
                />
                <span className={site.orderPullEnabled ? 'text-emerald-700' : 'text-slate-500'}>
                  {site.orderPullEnabled ? t('common.on') : t('common.off')}
                </span>
              </label>
            ) : (
              <Badge tone={site.orderPullEnabled ? 'green' : 'gray'}>
                {site.orderPullEnabled ? t('common.enabled') : t('common.disabled')}
              </Badge>
            )}
          </div>
        </div>
      )}

      {canSchedule ? (
        <div className="-mt-1 flex items-center gap-2 text-xs">
          <label className="text-slate-500">{t('sync.interval')}</label>
          <select
            className="focus:border-brand-500 focus:ring-brand-500 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
            value={intervalMin}
            disabled={scheduleLoading}
            onChange={(e) => onIntervalChange(Number(e.target.value) * 60_000)}
          >
            {[5, 10, 15, 30, 60].map((min) => (
              <option key={min} value={min}>
                {t('sync.everyMin', { min })}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="-mt-1 text-xs text-slate-500">{t('sync.everyMin', { min: intervalMin })}</p>
      )}

      {canMutate && (
        <div className="flex flex-wrap gap-2">
          {site.platform === 'NOPCOMMERCE_ASPNET' && (
            <label
              className={
                'inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ' +
                (mappingImportLoading ? 'pointer-events-none opacity-60' : '')
              }
            >
              {mappingImportLoading ? t('common.loading') : t('sync.importAspNetMappings')}
              <input
                type="file"
                accept=".tsv,text/tab-separated-values,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImportMappings(file);
                  event.target.value = '';
                }}
              />
            </label>
          )}
          {site.platform === 'NOPCOMMERCE_ASPNET' && (
            <Button
              onClick={onPreview}
              type="button"
              disabled={!site.isActive}
              loading={previewLoading}
              variant="secondary"
              className="flex-1"
            >
              {t('sync.previewPriceStock')}
            </Button>
          )}
          <Button onClick={onPush} type="button" disabled={!site.isActive} className="flex-1">
            {!site.isActive
              ? t('sync.siteInactive')
              : site.platform === 'NOPCOMMERCE_ASPNET'
                ? t('sync.pushPriceStock')
                : t('sync.pushProducts')}
          </Button>
          {site.platform !== 'NOPCOMMERCE_ASPNET' && (
            <Button
              onClick={onPull}
              type="button"
              disabled={!site.isActive}
              variant="secondary"
              className="flex-1"
            >
              {t('sync.pullOrders')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function JobMobileCard({ job }: { job: SyncJob }) {
  const { t } = useTranslation();
  const isPull = job.direction === 'PULL';
  const r = job.report as Record<string, number | undefined> | null;
  const processed = isPull ? (r?.pulled ?? job.pushedCount) : (r?.pushed ?? job.pushedCount);
  const failed = r?.failed ?? job.failedCount;

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-900">{job.site?.name ?? job.siteId}</p>
        <div className="flex items-center gap-1.5">
          <DirectionBadge direction={job.direction} />
          <StatusBadge status={job.status} />
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {isPull
          ? t('sync.pulled', { count: processed ?? 0 })
          : t('sync.pushed', { count: processed ?? 0 })}{' '}
        · {t('sync.failed')} {failed}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">
        {job.startedAt ? formatDateTime(job.startedAt) : t('common.queued')}
      </p>
    </div>
  );
}

function JobRow({ job }: { job: SyncJob }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const report = job.report;
  const errors = job.errors ?? (report as any)?.errors ?? [];
  const isPull = job.direction === 'PULL';
  const processed = isPull
    ? ((report as any)?.pulled ?? job.pushedCount)
    : (report?.pushed ?? job.pushedCount);
  const created = isPull ? (report as any)?.created : report?.created;
  const updated = isPull ? (report as any)?.updated : report?.updated;
  const errorList = Array.isArray(errors) ? errors : [];

  return (
    <>
      <tr
        className={errorList.length ? 'cursor-pointer' : ''}
        onClick={() => errorList.length && setExpanded((v) => !v)}
      >
        <td className="font-medium text-slate-900">{job.site?.name ?? job.siteId}</td>
        <td>
          <DirectionBadge direction={job.direction} />
        </td>
        <td>
          <Badge tone="gray">{job.scope}</Badge>
        </td>
        <td>
          <StatusBadge status={job.status} />
        </td>
        <td>{processed}</td>
        <td>{report ? `${created ?? 0} / ${updated ?? 0}` : t('common.emDash')}</td>
        <td className={errorList.length ? 'text-rose-600' : ''}>
          {report?.failed ?? job.failedCount}
        </td>
        <td className="text-xs text-slate-500">
          {job.startedAt ? formatDateTime(job.startedAt) : t('common.emDash')}
        </td>
        <td className="text-xs text-slate-500">
          {job.finishedAt ? formatDateTime(job.finishedAt) : t('common.emDash')}
        </td>
      </tr>
      {expanded && errorList.length > 0 && (
        <tr className="bg-rose-50/40">
          <td colSpan={9} className="px-4 py-2">
            <ul className="space-y-1 text-xs text-rose-800">
              {errorList
                .slice(0, 25)
                .map((e: Record<string, string | number | undefined>, i: number) => (
                  <li key={i}>
                    <span className="font-mono">{e.sku ?? e.orderNumber ?? e.remoteOrderId}</span>{' '}
                    {e.sourceProductId ? (
                      <span className="font-mono text-slate-500">
                        [Product:{e.sourceProductId}]{' '}
                      </span>
                    ) : null}
                    {e.sourceCombinationId ? (
                      <span className="font-mono text-slate-500">
                        [Combination:{e.sourceCombinationId}]{' '}
                      </span>
                    ) : null}
                    — {e.message}
                    {e.code ? <span className="ms-1 text-rose-500">({e.code})</span> : null}
                  </li>
                ))}
              {errorList.length > 25 && (
                <li className="text-slate-500">
                  {t('sync.moreErrors', { count: errorList.length - 25 })}
                </li>
              )}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function LogRow({
  log,
  canDelete,
  onDelete,
}: {
  log: SyncLogRow;
  canDelete?: boolean;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const tone = log.status === 'success' ? 'green' : log.status === 'partial' ? 'amber' : 'red';

  return (
    <tr>
      <td className="font-medium text-slate-900">{log.site?.name ?? log.siteId}</td>
      <td className="font-mono text-xs">{log.syncType}</td>
      <td>
        <Badge tone={tone as 'green' | 'amber' | 'red'}>
          {t(`syncStatus.${log.status}`, log.status)}
        </Badge>
      </td>
      <td className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</td>
      {canDelete && (
        <td className="text-end">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="text-rose-600 hover:bg-rose-50"
            onClick={onDelete}
          >
            {t('common.delete')}
          </Button>
        </td>
      )}
    </tr>
  );
}

const SYNC_JOB_STATUS_TONE: Record<SyncJobStatus, 'gray' | 'blue' | 'amber' | 'green' | 'red'> = {
  QUEUED: 'gray',
  PROCESSING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  CANCELLED: 'gray',
};

function StatusBadge({ status }: { status: SyncJobStatus }) {
  const { t } = useTranslation();
  return <Badge tone={SYNC_JOB_STATUS_TONE[status]}>{t(`syncJobStatus.${status}`, status)}</Badge>;
}
