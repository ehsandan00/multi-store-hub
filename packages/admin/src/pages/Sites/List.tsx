import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function routeLabel(route: SafeSite['networkRoute'], t: (key: string) => string) {
  return route === 'DIRECT' ? t('sites.directIr') : t('sites.viaProxy');
}

export function SitesList() {
  const { t } = useTranslation();
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
          t('sites.connectionOkToast', {
            latencyMs: res.latencyMs,
            routeUsed: t(
              res.routeUsed === 'DIRECT' ? 'sites.routeUsedDirect' : 'sites.routeUsedProxy',
              res.routeUsed,
            ),
          }),
          `Status ${res.status}`,
        );
      } else {
        toast.error(
          t('sites.connectionFailedToast'),
          res.error ? `${res.error.code}: ${res.error.message}` : undefined,
        );
      }
    },
    onError: (err, id) => {
      toast.error(t('sites.testFailed'), toApiError(err).message);
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
      toast.success(t('sites.deletedSuccess'));
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast.error(t('sites.deleteFailed'), toApiError(err).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('sites.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('sites.subtitle')}{' '}
            {!canMutate && t('common.readOnly')}
          </p>
        </div>
        {canMutate && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t('sites.addSite')}
          </Button>
        )}
      </div>

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

      <div className="table-wrap hidden md:block">
        <table className="table">
          <thead>
            <tr>
              <th>{t('sites.name')}</th>
              <th>{t('sites.baseUrl')}</th>
              <th>{t('sites.route')}</th>
              <th>{t('sites.credentials')}</th>
              <th>{t('sites.status')}</th>
              <th>{t('sites.lastTest')}</th>
              <th className="text-end">{t('products.actions')}</th>
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
                  {t('sites.loadFailed', { message: toApiError(listQ.error).message })}
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
                      <Badge tone="green">{t('sites.directIr')}</Badge>
                    ) : (
                      <Badge tone="blue">{t('sites.viaProxy')}</Badge>
                    )}
                  </td>
                  <td className="font-mono text-xs text-slate-500">
                    {s.consumerKeyMasked} / {s.consumerSecretMasked}
                  </td>
                  <td>
                    {s.isActive ? (
                      <Badge tone="green">{t('common.active')}</Badge>
                    ) : (
                      <Badge tone="gray">{t('common.inactive')}</Badge>
                    )}
                  </td>
                  <td>
                    {r ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        {r.ok ? (
                          <>
                            <Badge tone="green">{t('common.ok')}</Badge>
                            <span className="text-slate-500">{r.latencyMs}ms</span>
                          </>
                        ) : (
                          <>
                            <Badge tone="red">{t('sites.fail')}</Badge>
                            <span className="text-slate-500" title={r.error?.message}>
                              {r.error?.code}
                            </span>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">{t('common.emDash')}</span>
                    )}
                  </td>
                  <td className="text-end">
                    <div className="flex items-center justify-end gap-1">
                      {canTestConnection && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={testingId === s.id}
                          onClick={() => testMut.mutate(s.id)}
                          type="button"
                        >
                          {t('sites.test')}
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
                          {t('common.edit')}
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
                          {t('common.delete')}
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
                  {t('sites.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <SiteFormModal
          key={editing?.id ?? 'new'}
          open={formOpen}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          initial={editing}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('sites.deleteTitle')}
        message={t('sites.deleteAudited', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
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
  const { t } = useTranslation();

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{site.name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{site.baseUrl}</p>
        </div>
        {site.isActive ? (
          <Badge tone="green">{t('common.active')}</Badge>
        ) : (
          <Badge tone="gray">{t('common.inactive')}</Badge>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('sites.route')}</p>
          <p>{site.networkRoute === 'DIRECT' ? t('sites.directIr') : t('sites.viaProxy')}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('sites.credentials')}</p>
          <p className="font-mono">{site.consumerKeyMasked}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{t('sites.updatedAt')}</p>
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
              {t('sites.connectionOk', {
                latencyMs: result.latencyMs,
                routeUsed: routeLabel(result.routeUsed as SafeSite['networkRoute'], t),
              })}
              {result.status ? ` · HTTP ${result.status}` : ''}
            </>
          ) : (
            <>
              {t('sites.connectionFailed', {
                code: result.error?.code,
                message: result.error?.message,
              })}
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canTest && (
          <Button variant="secondary" size="sm" loading={testing} onClick={onTest} type="button">
            {t('sites.testConnection')}
          </Button>
        )}
        {canMutate && (
          <Button variant="secondary" size="sm" onClick={onEdit} type="button">
            {t('common.edit')}
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
            {t('common.delete')}
          </Button>
        )}
      </div>
    </div>
  );
}
