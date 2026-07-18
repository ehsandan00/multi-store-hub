import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { importExportApi, sitesApi, toApiError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { useToast } from '../lib/toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Input, Select } from '../components/ui/Field';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatDateTime } from '../lib/utils';
import type {
  ExportFilters,
  ImportError,
  ImportJob,
  ImportJobStatus,
  ImportPreview,
} from '../lib/types';

type Stage = 'idle' | 'preview' | 'processing' | 'report';

const STATUS_TONE: Record<ImportJobStatus, 'gray' | 'amber' | 'green' | 'red' | 'blue'> = {
  PREVIEW: 'amber',
  PROCESSING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  CANCELLED: 'gray',
};

export function ImportExportPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();

  const canMutate = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';
  const canExportWoo = canMutate;

  const [stage, setStage] = useState<Stage>('idle');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [finalJob, setFinalJob] = useState<ImportJob | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const [filters, setFilters] = useState<ExportFilters>({});
  const [wooSiteId, setWooSiteId] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });

  const jobsQ = useQuery({
    queryKey: ['import-jobs', { page: 1, pageSize: 10 }],
    queryFn: () => importExportApi.listJobs(1, 10),
    refetchInterval: stage === 'processing' ? 2000 : false,
  });

  useEffect(() => {
    if (stage !== 'processing' || !jobId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const job = await importExportApi.getJob(jobId);
        if (cancelled) return;
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          clearInterval(interval);
          setFinalJob(job);
          setStage('report');
          qc.invalidateQueries({ queryKey: ['import-jobs'] });
          qc.invalidateQueries({ queryKey: ['products'] });
          if (job.status === 'COMPLETED') {
            toast.success(
              t('importExport.importComplete', {
                created: job.createdCount,
                updated: job.updatedCount,
              }),
              job.failedCount
                ? t('importExport.importRowsFailed', { count: job.failedCount })
                : undefined,
            );
          } else {
            toast.error(t('importExport.importJobFailed'));
          }
        }
      } catch {
        // keep polling; transient errors are fine
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [stage, jobId, toast, qc, t]);

  const uploadMut = useMutation({
    mutationFn: (file: File) => importExportApi.uploadPreview(file),
    onSuccess: (p) => {
      setPreview(p);
      setJobId(p.jobId);
      setFinalJob(null);
      setStage('preview');
      toast.success(
        t('importExport.parsedRows', { count: p.totalRows }),
        t('importExport.parsedSummary', {
          new: p.newCount,
          updates: p.updateCount,
          errors: p.errorCount,
        }),
      );
    },
    onError: (err) => toast.error(t('importExport.uploadFailed'), toApiError(err).message),
  });

  const commitMut = useMutation({
    mutationFn: (id: string) => importExportApi.commit(id),
    onSuccess: () => {
      setStage('processing');
      qc.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (err) => toast.error(t('importExport.startImportFailed'), toApiError(err).message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => importExportApi.cancel(id),
    onSuccess: () => {
      setCancelOpen(false);
      reset();
      toast.success(t('importExport.importCancelled'));
      qc.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (err) => toast.error(t('importExport.cancelFailed'), toApiError(err).message),
  });

  const exportMut = useMutation({
    mutationFn: (f: ExportFilters) => importExportApi.exportProducts(f),
    onSuccess: () => toast.success(t('importExport.exportDownloaded')),
    onError: (err) => toast.error(t('importExport.exportFailed'), toApiError(err).message),
  });

  const wooExportMut = useMutation({
    mutationFn: ({ siteId, name }: { siteId: string; name?: string }) =>
      importExportApi.exportForWooCommerce(siteId, name),
    onSuccess: () => toast.success(t('importExport.wooDownloaded')),
    onError: (err) => toast.error(t('importExport.exportFailed'), toApiError(err).message),
  });

  function reset() {
    setStage('idle');
    setPreview(null);
    setJobId(null);
    setFinalJob(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error(t('importExport.uploadXlsxOnly'));
      return;
    }
    uploadMut.mutate(file);
  }

  const siteOptions = sitesQ.data?.data ?? [];
  const selectedSite = siteOptions.find((s) => s.id === wooSiteId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('importExport.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('importExport.subtitle')}{' '}
          {!canMutate && t('common.readOnlyExports')}
        </p>
      </div>

      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{t('importExport.export')}</h2>
          <Badge tone="green">xlsx</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t('importExport.exportFiltersHint')}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label={t('products.category')}
            value={filters.category ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}
          />
          <Select
            label={t('importExport.mappedToSite')}
            value={filters.siteId ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, siteId: e.target.value || undefined }))}
          >
            <option value="">{t('importExport.any')}</option>
            {siteOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label={t('importExport.minStock')}
            type="number"
            min={0}
            placeholder="0"
            value={filters.minStock ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                minStock: e.target.value === '' ? undefined : Number(e.target.value),
              }))
            }
          />
          <Input
            label={t('importExport.maxStock')}
            type="number"
            min={0}
            placeholder={t('importExport.any')}
            value={filters.maxStock ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                maxStock: e.target.value === '' ? undefined : Number(e.target.value),
              }))
            }
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => exportMut.mutate(filters)}
            loading={exportMut.isPending}
            type="button"
          >
            {t('importExport.downloadXlsx')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void importExportApi.downloadTemplate()}
            type="button"
          >
            {t('importExport.downloadTemplate')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t('importExport.templateHint')}</p>
        <p className="mt-1 text-xs text-slate-500">{t('importExport.roundTripHint')}</p>
        <p className="mt-1 text-xs text-slate-500">{t('importExport.variableProductHint')}</p>

        {canExportWoo && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t('importExport.wooCsv')}
            </h3>
            <p className="mt-1 text-xs text-slate-500">{t('importExport.wooDesc')}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Select
                label={t('orders.site')}
                value={wooSiteId}
                onChange={(e) => setWooSiteId(e.target.value)}
                className="min-w-[220px]"
              >
                <option value="">{t('importExport.selectSite')}</option>
                {siteOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                onClick={() =>
                  wooSiteId &&
                  wooExportMut.mutate({ siteId: wooSiteId, name: selectedSite?.name })
                }
                loading={wooExportMut.isPending}
                disabled={!wooSiteId}
                type="button"
              >
                {t('importExport.downloadCsv')}
              </Button>
            </div>
          </div>
        )}
      </section>

      {canMutate && (
        <section className="card p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('importExport.import')}</h2>
            <Badge tone="blue">{t('importExport.importBadge')}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t('importExport.importLongDesc')}</p>

          {stage === 'idle' && (
            <div className="mt-4">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40">
                <span className="text-3xl" aria-hidden="true">📥</span>
                <span className="mt-2 text-sm font-medium text-slate-700">
                  {t('importExport.uploadClick')}
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  {t('importExport.uploadColumnsHint')}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
              {uploadMut.isPending && (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                  <Spinner className="h-4 w-4" /> {t('importExport.parsing')}
                </div>
              )}
            </div>
          )}

          {stage === 'preview' && preview && (
            <PreviewStep
              preview={preview}
              onCommit={() => jobId && commitMut.mutate(jobId)}
              onCancel={() => setCancelOpen(true)}
              committing={commitMut.isPending}
            />
          )}

          {stage === 'processing' && (
            <div className="mt-4 flex items-center gap-3 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">
              <Spinner className="h-4 w-4" />
              <div>
                <p className="font-medium">{t('importExport.processing')}</p>
                <p className="text-xs text-brand-700">{t('importExport.processingHint')}</p>
              </div>
            </div>
          )}

          {stage === 'report' && finalJob && (
            <ReportStep job={finalJob} onDone={reset} />
          )}
        </section>
      )}

      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{t('importExport.recentJobs')}</h2>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('importExport.file')}</th>
                <th>{t('orders.status')}</th>
                <th>{t('importExport.rows')}</th>
                <th>{t('importExport.createdUpdatedFailed')}</th>
                <th>{t('importExport.started')}</th>
                <th>{t('importExport.by')}</th>
              </tr>
            </thead>
            <tbody>
              {jobsQ.isLoading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {jobsQ.data?.data.map((j) => (
                <tr key={j.id}>
                  <td className="font-medium text-slate-900">{j.fileName}</td>
                  <td>
                    <Badge tone={STATUS_TONE[j.status]}>
                      {t(`importJobStatus.${j.status}`, j.status)}
                    </Badge>
                  </td>
                  <td className="text-slate-600">{j.totalRows}</td>
                  <td className="text-slate-600">
                    {j.createdCount} / {j.updatedCount} / {j.failedCount}
                  </td>
                  <td className="text-slate-500">{formatDateTime(j.startedAt)}</td>
                  <td className="text-slate-500">{j.user?.email ?? t('common.emDash')}</td>
                </tr>
              ))}
              {jobsQ.data && jobsQ.data.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    {t('importExport.noJobs')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={cancelOpen}
        title={t('importExport.cancelTitle')}
        message={t('importExport.cancelMessage')}
        confirmLabel={t('common.discard')}
        destructive
        loading={cancelMut.isPending}
        onConfirm={() => jobId && cancelMut.mutate(jobId)}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}

function PreviewStep({
  preview,
  onCommit,
  onCancel,
  committing,
}: {
  preview: ImportPreview;
  onCommit: () => void;
  onCancel: () => void;
  committing: boolean;
}) {
  const { t } = useTranslation();
  const hasErrors = preview.errorCount > 0;
  const canCommit = preview.newCount + preview.updateCount > 0;
  const totalValid = preview.newCount + preview.updateCount;
  const showOfTotal = totalValid > preview.rowsPreview.length;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('importExport.totalRows')} value={preview.totalRows} tone="gray" />
        <Stat label={t('importExport.new')} value={preview.newCount} tone="green" />
        <Stat label={t('importExport.updates')} value={preview.updateCount} tone="blue" />
        <Stat
          label={t('importExport.errors')}
          value={preview.errorCount}
          tone={hasErrors ? 'red' : 'gray'}
        />
      </div>

      {hasErrors && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-800">
            {t('importExport.errorRowsSkipped', { count: preview.errorCount })}
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-rose-700">
            {preview.errors.slice(0, 100).map((e, i) => (
              <li key={i}>
                <span className="font-mono">
                  {t('importExport.row')} {e.row}
                </span>
                {e.sku ? ` · ${e.sku}` : ''}: {e.message}
              </li>
            ))}
            {preview.errors.length > 100 && (
              <li className="text-rose-500">
                {t('importExport.andMore', { count: preview.errors.length - 100 })}
              </li>
            )}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('importExport.validatedRows', {
            shown: preview.rowsPreview.length,
            total: showOfTotal ? t('importExport.ofTotal', { total: totalValid }) : '',
          })}
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>{t('importExport.row')}</th>
                <th>{t('products.sku')}</th>
                <th>{t('products.name')}</th>
                <th>{t('products.stock')}</th>
                <th>{t('products.price')}</th>
                <th>{t('importExport.action')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.rowsPreview.map((r) => (
                <tr key={r.row}>
                  <td className="font-mono text-xs text-slate-500">{r.row}</td>
                  <td className="font-mono text-xs text-slate-900">{r.skuMaster}</td>
                  <td className="max-w-[240px] truncate text-slate-700">
                    {r.name ?? t('common.emDash')}
                  </td>
                  <td className="text-slate-600">{r.totalStock ?? t('common.emDash')}</td>
                  <td className="text-slate-600">{r.basePrice ?? t('common.emDash')}</td>
                  <td>
                    {r.action === 'create' ? (
                      <Badge tone="green">{t('importExport.create')}</Badge>
                    ) : (
                      <Badge tone="blue">{t('importExport.update')}</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {preview.rowsPreview.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-400">
                    {t('importExport.noValidRows')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onCommit} loading={committing} disabled={!canCommit} type="button">
          {t('importExport.confirmImport', { count: preview.newCount + preview.updateCount })}
        </Button>
        <Button variant="ghost" onClick={onCancel} type="button">
          {t('common.cancel')}
        </Button>
        {!canCommit && (
          <span className="text-xs text-slate-500">{t('importExport.nothingToCommit')}</span>
        )}
      </div>
    </div>
  );
}

function ReportStep({ job, onDone }: { job: ImportJob; onDone: () => void }) {
  const { t } = useTranslation();
  const report = job.report;
  const errors: ImportError[] = report?.errors ?? job.errors ?? [];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t('products.created')} value={report?.created ?? job.createdCount} tone="green" />
        <Stat label={t('products.updated')} value={report?.updated ?? job.updatedCount} tone="blue" />
        <Stat
          label={t('sync.failed')}
          value={report?.failed ?? job.failedCount}
          tone={(report?.failed ?? job.failedCount) > 0 ? 'red' : 'gray'}
        />
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-800">{t('importExport.failedRows')}</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-rose-700">
            {errors.slice(0, 200).map((e, i) => (
              <li key={i}>
                <span className="font-mono">
                  {t('importExport.row')} {e.row}
                </span>
                {e.sku ? ` · ${e.sku}` : ''}: {e.message}
              </li>
            ))}
            {errors.length > 200 && (
              <li className="text-rose-500">
                {t('importExport.andMore', { count: errors.length - 200 })}
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={onDone} type="button">
          {t('importExport.doneUploadAnother')}
        </Button>
      </div>
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
  tone: 'gray' | 'green' | 'blue' | 'red';
}) {
  const cls: Record<typeof tone, string> = {
    gray: 'bg-slate-50 text-slate-900',
    green: 'bg-emerald-50 text-emerald-900',
    blue: 'bg-brand-50 text-brand-900',
    red: 'bg-rose-50 text-rose-900',
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${cls[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}
