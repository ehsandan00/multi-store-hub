import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sitesApi, toApiError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import { useToast } from '../../lib/toast';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SiteFormModal } from './Form';
import { formatDateTime } from '../../lib/utils';
import type { SafeSite, TestConnectionResult } from '../../lib/types';

export function SitesList() {
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();
  const canMutate = user?.role === 'ADMIN';
  const canTestConnection = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SafeSite | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeSite | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, TestConnectionResult>>({});

  const listQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => sitesApi.testConnection(id),
    onMutate: (id) => {
      setTestingId(id);
      setTestResult((r) => ({ ...r, [id]: undefined! }));
    },
    onSuccess: (res, id) => {
      setTestResult((r) => ({ ...r, [id]: res }));
      if (res.ok) {
        toast.success(
          `Connection OK (${res.latencyMs}ms via ${res.routeUsed})`,
          `Status ${res.status}`,
        );
      } else {
        toast.error(
          `Connection failed`,
          res.error ? `${res.error.code}: ${res.error.message}` : undefined,
        );
      }
    },
    onError: (err, id) => {
      toast.error('Test connection failed', toApiError(err).message);
      setTestResult((r) => ({
        ...r,
        [id]: {
          ok: false,
          latencyMs: 0,
          routeUsed: 'DIRECT',
          attempts: 0,
          error: { code: 'CLIENT', message: toApiError(err).message },
        },
      }));
    },
    onSettled: () => setTestingId(null),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => sitesApi.remove(id),
    onSuccess: () => {
      toast.success('Site deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast.error('Failed to delete site', toApiError(err).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Sites</h1>
          <p className="mt-1 text-sm text-slate-500">
            The 8 WooCommerce stores.{' '}
            {!canMutate && 'You have read-only access.'}
          </p>
        </div>
        {canMutate && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + Add site
          </Button>
        )}
      </div>

      {/* Mobile cards */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
        {listQ.isLoading && (
          <div className="card flex justify-center p-6">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {listQ.data?.data.map((s) => (
          <SiteCard
            key={s.id}
            site={s}
            canMutate={canMutate}
            canTest={canTestConnection}
            testing={testingId === s.id}
            result={testResult[s.id]}
            onEdit={() => {
              setEditing(s);
              setFormOpen(true);
            }}
            onDelete={() => setDeleteTarget(s)}
            onTest={() => testMut.mutate(s.id)}
          />
        ))}
      </div>

      {/* Desktop table */}
      <div className="table-wrap hidden md:block">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Base URL</th>
              <th>Route</th>
              <th>Credentials</th>
              <th>Status</th>
              <th>Last test</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {listQ.isError && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-rose-600">
                  Failed to load sites: {toApiError(listQ.error).message}
                </td>
              </tr>
            )}
            {listQ.data?.data.map((s) => {
              const r = testResult[s.id];
              return (
                <tr key={s.id}>
                  <td className="font-medium text-slate-900">{s.name}</td>
                  <td className="max-w-[260px] truncate font-mono text-xs">{s.baseUrl}</td>
                  <td>
                    {s.networkRoute === 'DIRECT' ? (
                      <Badge tone="green">Direct (IR)</Badge>
                    ) : (
                      <Badge tone="blue">Via foreign proxy</Badge>
                    )}
                  </td>
                  <td className="font-mono text-xs text-slate-500">
                    {s.consumerKeyMasked} / {s.consumerSecretMasked}
                  </td>
                  <td>
                    {s.isActive ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}
                  </td>
                  <td>
                    {r ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        {r.ok ? (
                          <>
                            <Badge tone="green">OK</Badge>
                            <span className="text-slate-500">{r.latencyMs}ms</span>
                          </>
                        ) : (
                          <>
                            <Badge tone="red">fail</Badge>
                            <span className="text-slate-500" title={r.error?.message}>
                              {r.error?.code}
                            </span>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canTestConnection && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={testingId === s.id}
                          onClick={() => testMut.mutate(s.id)}
                          type="button"
                        >
                          Test
                        </Button>
                      )}
                      {canMutate && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditing(s);
                            setFormOpen(true);
                          }}
                          type="button"
                        >
                          Edit
                        </Button>
                      )}
                      {canMutate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:bg-rose-50"
                          onClick={() => setDeleteTarget(s)}
                          type="button"
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {listQ.data && listQ.data.data.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No sites configured yet. Click “Add site” to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <SiteFormModal open={formOpen} onClose={() => setFormOpen(false)} initial={editing} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete site"
        message={
          <>
            Delete <strong>{deleteTarget?.name}</strong>? Its sync logs remain for diagnostics.
            This action is audited.
          </>
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function SiteCard({
  site,
  canMutate,
  canTest,
  testing,
  result,
  onEdit,
  onDelete,
  onTest,
}: {
  site: SafeSite;
  canMutate: boolean;
  canTest: boolean;
  testing: boolean;
  result?: TestConnectionResult;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{site.name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{site.baseUrl}</p>
        </div>
        {site.isActive ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Route</p>
          <p>{site.networkRoute === 'DIRECT' ? 'Direct (IR)' : 'Via foreign proxy'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Credentials</p>
          <p className="font-mono">{site.consumerKeyMasked}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Updated</p>
          <p>{formatDateTime(site.updatedAt)}</p>
        </div>
      </div>

      {result && (
        <div
          className={
            'mt-3 rounded-lg p-2 text-xs ' +
            (result.ok
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-rose-50 text-rose-800')
          }
        >
          {result.ok ? (
            <>
              ✓ OK · {result.latencyMs}ms · {result.routeUsed}
              {result.status ? ` · HTTP ${result.status}` : ''}
            </>
          ) : (
            <>✗ Failed · {result.error?.code}: {result.error?.message}</>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canTest && (
          <Button variant="secondary" size="sm" loading={testing} onClick={onTest} type="button">
            Test connection
          </Button>
        )}
        {canMutate && (
          <Button variant="secondary" size="sm" onClick={onEdit} type="button">
            Edit
          </Button>
        )}
        {canMutate && (
          <Button
            variant="ghost"
            size="sm"
            className="text-rose-600 hover:bg-rose-50"
            onClick={onDelete}
            type="button"
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
