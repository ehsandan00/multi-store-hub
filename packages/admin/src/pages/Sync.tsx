import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { syncApi, sitesApi, toApiError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { useToast } from '../lib/toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatDateTime } from '../lib/utils';
import type { SafeSite, SyncJob, SyncJobStatus, SyncLogRow, SyncScope } from '../lib/types';

/**
 * Phase 3 + Phase 4 sync page.
 *
 * - Per-site card: schedule toggles + interval, "Push products" and "Pull
 *   orders" buttons (each enqueues a BullMQ sync job), last sync / last pull
 *   timestamps, and a live status pill for the most recent job.
 * - Sync jobs table: recent push + pull jobs with status + report summary and
 *   an expandable per-item error list.
 * - Sync logs table: the SyncLog audit trail (one row per sync run).
 *
 * VIEWERs can read everything but cannot trigger syncs or change schedules
 * (the buttons are hidden; the backend enforces RBAC regardless).
 */
export function SyncPage() {
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();
  const canMutate = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';
  const canSchedule = user?.role === 'ADMIN';

  const [pushTarget, setPushTarget] = useState<SafeSite | null>(null);
  const [pushScope, setPushScope] = useState<SyncScope>('ALL');
  const [pullTarget, setPullTarget] = useState<SafeSite | null>(null);

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });
  const jobsQ = useQuery({
    queryKey: ['sync-jobs', { page: 1, pageSize: 25 }],
    queryFn: () => syncApi.listJobs({ page: 1, pageSize: 25 }),
    refetchInterval: 5_000, // poll while jobs may be PROCESSING
  });
  const logsQ = useQuery({
    queryKey: ['sync-logs', { page: 1, pageSize: 25 }],
    queryFn: () => syncApi.listLogs({ page: 1, pageSize: 25 }),
  });

  const pushMut = useMutation({
    mutationFn: ({ siteId, scope }: { siteId: string; scope: SyncScope }) =>
      syncApi.push(siteId, { scope }),
    onSuccess: (res: { id: string; status: SyncJobStatus; queued: boolean }) => {
      toast.success('Sync queued', `Job ${res.id}`);
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      setPushTarget(null);
    },
    onError: (err) => toast.error('Failed to queue sync', toApiError(err).message),
  });

  const pullMut = useMutation({
    mutationFn: (siteId: string) => syncApi.pull(siteId),
    onSuccess: (res: { id: string; status: SyncJobStatus; queued: boolean }) => {
      toast.success('Order pull queued', `Job ${res.id}`);
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      setPullTarget(null);
    },
    onError: (err) => toast.error('Failed to queue order pull', toApiError(err).message),
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
      toast.success('Schedule updated');
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast.error('Failed to update schedule', toApiError(err).message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">WooCommerce Sync</h1>
        <p className="mt-1 text-sm text-slate-500">
          Push hub products to each store and pull orders back into the hub. Both are idempotent and
          rate-limited per site. {!canMutate && 'You have read-only access.'}
        </p>
      </div>

      {/* Per-site cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sites</h2>
        {sitesQ.isLoading && (
          <div className="card flex justify-center p-6">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {sitesQ.isError && (
          <div className="card p-4 text-sm text-rose-600">
            Failed to load sites: {toApiError(sitesQ.error).message}
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
                setPushScope('ALL');
                setPushTarget(s);
              }}
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
            />
          ))}
          {sitesQ.data && sitesQ.data.data.length === 0 && (
            <div className="card col-span-full p-6 text-center text-sm text-slate-400">
              No sites configured. Add one on the Sites page.
            </div>
          )}
        </div>
      </section>

      {/* Sync jobs */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent sync jobs</h2>
        <div className="table-wrap hidden md:block">
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Dir</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Pushed/Pulled</th>
                <th>Created / Updated</th>
                <th>Failed</th>
                <th>Started</th>
                <th>Finished</th>
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
                    No sync jobs yet. Push products or pull orders to start.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Mobile cards for jobs */}
        <div className="grid grid-cols-1 gap-3 md:hidden">
          {jobsQ.data?.data.map((j) => {
            const isPull = j.direction === 'PULL';
            const r = j.report as any;
            const processed = isPull ? r?.pulled ?? j.pushedCount : r?.pushed ?? j.pushedCount;
            return (
              <div key={j.id} className="card p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-900">{j.site?.name ?? j.siteId}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={isPull ? 'blue' : 'gray'}>{j.direction}</Badge>
                    <StatusBadge status={j.status} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {isPull ? 'pulled' : 'pushed'} {processed} · failed {r?.failed ?? j.failedCount}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {j.startedAt ? formatDateTime(j.startedAt) : 'queued'}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Sync logs */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sync log</h2>
        <div className="table-wrap hidden md:block">
          <table className="table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Type</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {logsQ.isLoading && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {logsQ.data?.data.map((l) => (
                <LogRow key={l.id} log={l} />
              ))}
              {logsQ.data && logsQ.data.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">
                    No sync activity logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={!!pushTarget}
        title={`Push products to ${pushTarget?.name ?? ''}`}
        message={
          <>
            Enqueue a WooCommerce product push? This is idempotent — existing remote products (matched by
            SKU) will be updated; new ones will be created. The job runs in the background via BullMQ.
          </>
        }
        confirmLabel="Queue push"
        loading={pushMut.isPending}
        onConfirm={() => pushTarget && pushMut.mutate({ siteId: pushTarget.id, scope: pushScope })}
        onCancel={() => setPushTarget(null)}
      />

      <ConfirmDialog
        open={!!pullTarget}
        title={`Pull orders from ${pullTarget?.name ?? ''}`}
        message={
          <>
            Enqueue an order pull? This fetches orders modified since the last pull
            {!pullTarget?.lastOrderPullAt && ' (all orders the first time)'} and upserts them into the hub
            by remote order id. Existing orders are updated; line items are replaced. Runs in the background via BullMQ.
          </>
        }
        confirmLabel="Queue pull"
        loading={pullMut.isPending}
        onConfirm={() => pullTarget && pullMut.mutate(pullTarget.id)}
        onCancel={() => setPullTarget(null)}
      />
    </div>
  );
}

function latestJobForSite(jobs: SyncJob[], siteId: string): SyncJob | undefined {
  return jobs.find((j) => j.siteId === siteId);
}

function SiteSyncCard({
  site,
  canMutate,
  canSchedule,
  lastJob,
  onPush,
  onPull,
  onToggleSchedule,
  onToggleOrderPull,
  onIntervalChange,
  scheduleLoading,
}: {
  site: SafeSite;
  canMutate: boolean;
  canSchedule: boolean;
  lastJob?: SyncJob;
  onPush: () => void;
  onPull: () => void;
  onToggleSchedule: (enabled: boolean) => void;
  onToggleOrderPull: (enabled: boolean) => void;
  onIntervalChange: (ms: number) => void;
  scheduleLoading: boolean;
}) {
  const intervalMin = Math.round(site.syncIntervalMs / 60_000);
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{site.name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{site.baseUrl}</p>
        </div>
        {site.networkRoute === 'DIRECT' ? (
          <Badge tone="green">Direct</Badge>
        ) : (
          <Badge tone="blue">Proxy</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Last push</p>
          <p>{site.lastSyncAt ? formatDateTime(site.lastSyncAt) : 'never'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Last pull</p>
          <p>{site.lastOrderPullAt ? formatDateTime(site.lastOrderPullAt) : 'never'}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Latest job</p>
          <p className="flex items-center gap-1.5">
            {lastJob ? (
              <>
                <Badge tone={lastJob.direction === 'PULL' ? 'blue' : 'gray'}>
                  {lastJob.direction}
                </Badge>
                <StatusBadge status={lastJob.status} />
              </>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </p>
        </div>
      </div>

      {/* Schedule controls — push */}
      <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-700">Scheduled product push</span>
          {canSchedule ? (
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={site.syncEnabled}
                disabled={scheduleLoading}
                onChange={(e) => onToggleSchedule(e.target.checked)}
              />
              <span className={site.syncEnabled ? 'text-emerald-700' : 'text-slate-500'}>
                {site.syncEnabled ? 'On' : 'Off'}
              </span>
            </label>
          ) : (
            <Badge tone={site.syncEnabled ? 'green' : 'gray'}>{site.syncEnabled ? 'enabled' : 'disabled'}</Badge>
          )}
        </div>
      </div>

      {/* Schedule controls — order pull */}
      <div className="rounded-lg bg-slate-50 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-700">Scheduled order pull</span>
          {canSchedule ? (
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={site.orderPullEnabled}
                disabled={scheduleLoading}
                onChange={(e) => onToggleOrderPull(e.target.checked)}
              />
              <span className={site.orderPullEnabled ? 'text-emerald-700' : 'text-slate-500'}>
                {site.orderPullEnabled ? 'On' : 'Off'}
              </span>
            </label>
          ) : (
            <Badge tone={site.orderPullEnabled ? 'green' : 'gray'}>
              {site.orderPullEnabled ? 'enabled' : 'disabled'}
            </Badge>
          )}
        </div>
      </div>

      {/* Shared interval */}
      {canSchedule ? (
        <div className="-mt-1 flex items-center gap-2 text-xs">
          <label className="text-slate-500">Interval (push &amp; pull)</label>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:ring-brand-500"
            value={intervalMin}
            disabled={scheduleLoading}
            onChange={(e) => onIntervalChange(Number(e.target.value) * 60_000)}
          >
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
          </select>
        </div>
      ) : (
        <p className="-mt-1 text-xs text-slate-500">Every {intervalMin} min{intervalMin === 1 ? '' : 's'} (push &amp; pull)</p>
      )}

      {canMutate && (
        <div className="flex gap-2">
          <Button onClick={onPush} type="button" disabled={!site.isActive} className="flex-1">
            {!site.isActive ? 'Site inactive' : 'Push products'}
          </Button>
          <Button onClick={onPull} type="button" disabled={!site.isActive} variant="secondary" className="flex-1">
            Pull orders
          </Button>
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: SyncJob }) {
  const [expanded, setExpanded] = useState(false);
  const report = job.report;
  const errors = job.errors ?? (report as any)?.errors ?? [];
  const isPull = job.direction === 'PULL';
  const processed = isPull ? (report as any)?.pulled ?? job.pushedCount : report?.pushed ?? job.pushedCount;
  const created = isPull ? (report as any)?.created : report?.created;
  const updated = isPull ? (report as any)?.updated : report?.updated;
  return (
    <>
      <tr className={errors.length ? 'cursor-pointer' : ''} onClick={() => errors.length && setExpanded((v) => !v)}>
        <td className="font-medium text-slate-900">{job.site?.name ?? job.siteId}</td>
        <td>
          <Badge tone={isPull ? 'blue' : 'gray'}>{isPull ? 'PULL' : 'PUSH'}</Badge>
        </td>
        <td>
          <Badge tone="gray">{job.scope}</Badge>
        </td>
        <td>
          <StatusBadge status={job.status} />
        </td>
        <td>{processed}</td>
        <td>{report ? `${created ?? 0} / ${updated ?? 0}` : '—'}</td>
        <td className={errors.length ? 'text-rose-600' : ''}>{report?.failed ?? job.failedCount}</td>
        <td className="text-xs text-slate-500">{job.startedAt ? formatDateTime(job.startedAt) : '—'}</td>
        <td className="text-xs text-slate-500">{job.finishedAt ? formatDateTime(job.finishedAt) : '—'}</td>
      </tr>
      {expanded && errors.length > 0 && (
        <tr className="bg-rose-50/40">
          <td colSpan={9} className="px-4 py-2">
            <ul className="space-y-1 text-xs text-rose-800">
              {errors.slice(0, 25).map((e: any, i: number) => (
                <li key={i}>
                  <span className="font-mono">{e.sku ?? e.orderNumber ?? e.remoteOrderId}</span> — {e.message}
                  {e.code ? <span className="ml-1 text-rose-500">({e.code})</span> : null}
                </li>
              ))}
              {errors.length > 25 && <li className="text-slate-500">…{errors.length - 25} more</li>}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function LogRow({ log }: { log: SyncLogRow }) {
  const tone = log.status === 'success' ? 'green' : log.status === 'partial' ? 'amber' : 'red';
  return (
    <tr>
      <td className="font-medium text-slate-900">{log.site?.name ?? log.siteId}</td>
      <td className="font-mono text-xs">{log.syncType}</td>
      <td>
        <Badge tone={tone as 'green' | 'amber' | 'red'}>{log.status}</Badge>
      </td>
      <td className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</td>
    </tr>
  );
}

function StatusBadge({ status }: { status: SyncJobStatus }) {
  const map: Record<SyncJobStatus, { tone: 'gray' | 'blue' | 'amber' | 'green' | 'red'; label: string }> = {
    QUEUED: { tone: 'gray', label: 'queued' },
    PROCESSING: { tone: 'blue', label: 'processing' },
    COMPLETED: { tone: 'green', label: 'completed' },
    FAILED: { tone: 'red', label: 'failed' },
    CANCELLED: { tone: 'gray', label: 'cancelled' },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}
