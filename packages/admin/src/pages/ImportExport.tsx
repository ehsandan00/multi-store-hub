import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();

  const canMutate = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';
  const canExportWoo = canMutate; // WC export is admin + warehouse per backend

  const [stage, setStage] = useState<Stage>('idle');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [finalJob, setFinalJob] = useState<ImportJob | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Export filters
  const [filters, setFilters] = useState<ExportFilters>({});
  const [wooSiteId, setWooSiteId] = useState('');

  // Upload
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

  // Poll job status while processing
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
              `Import complete: ${job.createdCount} created, ${job.updatedCount} updated`,
              job.failedCount ? `${job.failedCount} row(s) failed` : undefined,
            );
          } else {
            toast.error('Import job failed');
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
  }, [stage, jobId, toast, qc]);

  const uploadMut = useMutation({
    mutationFn: (file: File) => importExportApi.uploadPreview(file),
    onSuccess: (p) => {
      setPreview(p);
      setJobId(p.jobId);
      setFinalJob(null);
      setStage('preview');
      toast.success(
        `Parsed ${p.totalRows} rows`,
        `${p.newCount} new · ${p.updateCount} updates · ${p.errorCount} errors`,
      );
    },
    onError: (err) => toast.error('Upload failed', toApiError(err).message),
  });

  const commitMut = useMutation({
    mutationFn: (id: string) => importExportApi.commit(id),
    onSuccess: () => {
      setStage('processing');
      qc.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (err) => toast.error('Failed to start import', toApiError(err).message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => importExportApi.cancel(id),
    onSuccess: () => {
      setCancelOpen(false);
      reset();
      toast.success('Import cancelled');
      qc.invalidateQueries({ queryKey: ['import-jobs'] });
    },
    onError: (err) => toast.error('Failed to cancel', toApiError(err).message),
  });

  const exportMut = useMutation({
    mutationFn: (f: ExportFilters) => importExportApi.exportProducts(f),
    onSuccess: () => toast.success('Export downloaded'),
    onError: (err) => toast.error('Export failed', toApiError(err).message),
  });

  const wooExportMut = useMutation({
    mutationFn: ({ siteId, name }: { siteId: string; name?: string }) =>
      importExportApi.exportForWooCommerce(siteId, name),
    onSuccess: () => toast.success('WooCommerce CSV downloaded'),
    onError: (err) => toast.error('Export failed', toApiError(err).message),
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
      toast.error('Please upload an .xlsx file');
      return;
    }
    uploadMut.mutate(file);
  }

  const siteOptions = sitesQ.data?.data ?? [];
  const selectedSite = siteOptions.find((s) => s.id === wooSiteId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Excel Import / Export</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bulk-manage hub products via xlsx. Matching is by <code className="rounded bg-slate-100 px-1">sku_master</code>,
          so reordering rows is safe. {!canMutate && 'You have read-only access to exports.'}
        </p>
      </div>

      {/* ─── Export ─────────────────────────────────────────────────────────── */}
      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Export</h2>
          <Badge tone="green">xlsx</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Full hub export produces a Products sheet + a SiteMapping sheet. Filters narrow the Products sheet.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Category"
            placeholder="e.g. Snacks"
            value={filters.category ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}
          />
          <Select
            label="Mapped to site"
            value={filters.siteId ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, siteId: e.target.value || undefined }))}
          >
            <option value="">Any</option>
            {siteOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="Min stock"
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
            label="Max stock"
            type="number"
            min={0}
            placeholder="any"
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
            ⬇ Download .xlsx
          </Button>
        </div>

        {canExportWoo && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              WooCommerce-import-ready CSV
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Pick a site to produce a CSV in WooCommerce's default importer format. SKU uses the site
              mapping when present, otherwise the hub <code>sku_master</code>.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Select
                label="Site"
                value={wooSiteId}
                onChange={(e) => setWooSiteId(e.target.value)}
                className="min-w-[220px]"
              >
                <option value="">Select a site…</option>
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
                ⬇ Download .csv
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ─── Import ─────────────────────────────────────────────────────────── */}
      {canMutate && (
        <section className="card p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Import</h2>
            <Badge tone="blue">preview · confirm · queue</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Upload an xlsx. We validate without writing anything, then show a preview for your confirmation.
            The commit runs as a background job (BullMQ) so large files don't freeze the UI.
          </p>

          {stage === 'idle' && (
            <div className="mt-4">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40">
                <span className="text-3xl" aria-hidden="true">📥</span>
                <span className="mt-2 text-sm font-medium text-slate-700">
                  Click to choose an .xlsx file
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  Max 5 MB · 5,000 rows · columns: sku_master, name, base_price, total_stock, …
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
                  <Spinner className="h-4 w-4" /> Parsing & validating…
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
                <p className="font-medium">Applying changes in the background…</p>
                <p className="text-xs text-brand-700">This page will update automatically when the job finishes.</p>
              </div>
            </div>
          )}

          {stage === 'report' && finalJob && (
            <ReportStep job={finalJob} onDone={reset} />
          )}
        </section>
      )}

      {/* ─── Recent jobs ─────────────────────────────────────────────────────── */}
      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Recent import jobs</h2>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Created / Updated / Failed</th>
                <th>Started</th>
                <th>By</th>
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
                    <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                  </td>
                  <td className="text-slate-600">{j.totalRows}</td>
                  <td className="text-slate-600">
                    {j.createdCount} / {j.updatedCount} / {j.failedCount}
                  </td>
                  <td className="text-slate-500">{formatDateTime(j.startedAt)}</td>
                  <td className="text-slate-500">{j.user?.email ?? '—'}</td>
                </tr>
              ))}
              {jobsQ.data && jobsQ.data.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    No import jobs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this import?"
        message="The preview will be discarded. No data has been written yet."
        confirmLabel="Discard"
        destructive
        loading={cancelMut.isPending}
        onConfirm={() => jobId && cancelMut.mutate(jobId)}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}

// ─── Preview sub-component ───────────────────────────────────────────────────

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
  const hasErrors = preview.errorCount > 0;
  const canCommit = preview.newCount + preview.updateCount > 0;
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total rows" value={preview.totalRows} tone="gray" />
        <Stat label="New" value={preview.newCount} tone="green" />
        <Stat label="Updates" value={preview.updateCount} tone="blue" />
        <Stat label="Errors" value={preview.errorCount} tone={hasErrors ? 'red' : 'gray'} />
      </div>

      {hasErrors && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-800">
            {preview.errorCount} row(s) have errors and will be skipped:
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-rose-700">
            {preview.errors.slice(0, 100).map((e, i) => (
              <li key={i}>
                <span className="font-mono">row {e.row}</span>
                {e.sku ? ` · ${e.sku}` : ''}: {e.message}
              </li>
            ))}
            {preview.errors.length > 100 && (
              <li className="text-rose-500">… and {preview.errors.length - 100} more</li>
            )}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Validated rows (first {preview.rowsPreview.length}
          {preview.newCount + preview.updateCount > preview.rowsPreview.length ? ' of ' + (preview.newCount + preview.updateCount) : ''})
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Row</th>
                <th>SKU</th>
                <th>Name</th>
                <th>Stock</th>
                <th>Price</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {preview.rowsPreview.map((r) => (
                <tr key={r.row}>
                  <td className="font-mono text-xs text-slate-500">{r.row}</td>
                  <td className="font-mono text-xs text-slate-900">{r.skuMaster}</td>
                  <td className="max-w-[240px] truncate text-slate-700">{r.name ?? '—'}</td>
                  <td className="text-slate-600">{r.totalStock ?? '—'}</td>
                  <td className="text-slate-600">{r.basePrice ?? '—'}</td>
                  <td>
                    {r.action === 'create' ? (
                      <Badge tone="green">create</Badge>
                    ) : (
                      <Badge tone="blue">update</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {preview.rowsPreview.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-400">
                    No valid rows to preview.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onCommit} loading={committing} disabled={!canCommit} type="button">
          ✓ Confirm & import {preview.newCount + preview.updateCount} row(s)
        </Button>
        <Button variant="ghost" onClick={onCancel} type="button">
          Cancel
        </Button>
        {!canCommit && (
          <span className="text-xs text-slate-500">
            Nothing to commit — every row has an error.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Report sub-component ────────────────────────────────────────────────────

function ReportStep({ job, onDone }: { job: ImportJob; onDone: () => void }) {
  const report = job.report;
  const errors: ImportError[] = report?.errors ?? job.errors ?? [];
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Created" value={report?.created ?? job.createdCount} tone="green" />
        <Stat label="Updated" value={report?.updated ?? job.updatedCount} tone="blue" />
        <Stat label="Failed" value={report?.failed ?? job.failedCount} tone={(report?.failed ?? job.failedCount) > 0 ? 'red' : 'gray'} />
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-800">Failed rows:</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-rose-700">
            {errors.slice(0, 200).map((e, i) => (
              <li key={i}>
                <span className="font-mono">row {e.row}</span>
                {e.sku ? ` · ${e.sku}` : ''}: {e.message}
              </li>
            ))}
            {errors.length > 200 && (
              <li className="text-rose-500">… and {errors.length - 200} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={onDone} type="button">Done — upload another</Button>
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
