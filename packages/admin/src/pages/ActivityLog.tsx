import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { auditLogApi } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { formatDateTime } from '../lib/utils';

const ACTION_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  PRODUCT_CREATE: 'green',
  PRODUCT_UPDATE: 'blue',
  PRODUCT_DELETE: 'red',
  USER_CREATE: 'green',
  USER_UPDATE: 'blue',
  USER_DELETE: 'red',
  SYNC_PUSH: 'amber',
  ORDER_PULL: 'blue',
  MATCHING_APPROVE: 'green',
  MATCHING_REJECT: 'red',
};

export function ActivityLogPage() {
  const { t } = useTranslation();
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const listQ = useQuery({
    queryKey: ['audit-log', { action: actionFilter || undefined, page }],
    queryFn: () =>
      auditLogApi.list({
        action: actionFilter || undefined,
        page,
        pageSize,
      }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('activityLog.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('activityLog.subtitle')}</p>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-3">
        <Input
          id="action-filter"
          label={t('activityLog.filterAction')}
          placeholder={t('activityLog.filterActionPlaceholder')}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="min-w-[200px] flex-1"
        />
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setActionFilter('');
            setPage(1);
          }}
        >
          {t('common.reset')}
        </Button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('activityLog.when')}</th>
              <th>{t('activityLog.who')}</th>
              <th>{t('activityLog.action')}</th>
              <th>{t('activityLog.target')}</th>
              <th>{t('activityLog.details')}</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={5} className="py-8 text-center">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {listQ.data?.data.map((row) => {
              const details = row.details as {
                method?: string;
                path?: string;
                body?: Record<string, unknown>;
              } | null;
              const tone = ACTION_TONE[row.action] ?? 'gray';
              return (
                <tr key={row.id}>
                  <td className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td>
                    <div className="text-sm text-slate-900">
                      {row.userFullName ?? row.userEmail ?? t('activityLog.systemUser')}
                    </div>
                    {row.userEmail && (
                      <div className="text-xs text-slate-500">{row.userEmail}</div>
                    )}
                  </td>
                  <td>
                    <Badge tone={tone}>
                      {t(`activityLog.actions.${row.action}`, { defaultValue: row.action })}
                    </Badge>
                  </td>
                  <td className="font-mono text-xs text-slate-600">
                    {row.target ?? t('common.emDash')}
                  </td>
                  <td className="max-w-[280px] truncate text-xs text-slate-500">
                    {details?.method && details?.path
                      ? `${details.method} ${details.path}`
                      : t('common.emDash')}
                  </td>
                </tr>
              );
            })}
            {listQ.data?.data.length === 0 && !listQ.isLoading && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  {t('activityLog.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {listQ.data && listQ.data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>
            {t('common.pageOf', { page, totalPages: listQ.data.totalPages })} · {listQ.data.total}{' '}
            {t('activityLog.entries')}
          </p>
          <div className="flex gap-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              type="button"
            >
              {t('common.prev')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= listQ.data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              type="button"
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
