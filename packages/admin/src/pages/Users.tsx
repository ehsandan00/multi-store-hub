import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auditLogApi, usersApi, toApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { formatDateTime } from '../lib/utils';
import type { CreateUserPayload, Role, SafeUser, UpdateUserPayload } from '../lib/types';

const ROLE_TONE: Record<Role, 'blue' | 'amber' | 'gray'> = {
  ADMIN: 'blue',
  WAREHOUSE_STAFF: 'amber',
  VIEWER: 'gray',
};

const LOG_ACTION_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  USER_CREATE: 'green',
  USER_UPDATE: 'blue',
  USER_PASSWORD_CHANGE: 'amber',
};

export function UsersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SafeUser | null>(null);
  const [logTarget, setLogTarget] = useState<SafeUser | null>(null);

  const listQ = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('users.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('users.subtitle')}</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          {t('users.newUser')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:hidden">
        {listQ.isLoading && (
          <div className="card flex justify-center p-6">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {listQ.data?.map((u) => (
          <div key={u.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{u.fullName}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{u.email}</p>
              </div>
              <Badge tone={ROLE_TONE[u.role]}>{t(`roles.${u.role}`)}</Badge>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {t('users.createdAt', { date: formatDateTime(u.createdAt) })}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(u);
                  setFormOpen(true);
                }}
                type="button"
              >
                {t('common.edit')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLogTarget(u)} type="button">
                {t('users.viewLog')}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="table-wrap hidden md:block">
        <table className="table">
          <thead>
            <tr>
              <th>{t('users.name')}</th>
              <th>{t('users.email')}</th>
              <th>{t('users.role')}</th>
              <th>{t('users.status')}</th>
              <th>{t('users.created')}</th>
              <th className="text-end">{t('products.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {listQ.data?.map((u) => (
              <tr key={u.id}>
                <td className="font-medium text-slate-900">{u.fullName}</td>
                <td className="text-slate-600">{u.email}</td>
                <td>
                  <Badge tone={ROLE_TONE[u.role]}>{t(`roles.${u.role}`)}</Badge>
                </td>
                <td>
                  {u.isActive ? (
                    <Badge tone="green">{t('common.active')}</Badge>
                  ) : (
                    <Badge tone="gray">{t('common.inactive')}</Badge>
                  )}
                </td>
                <td>{formatDateTime(u.createdAt)}</td>
                <td className="text-end">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditing(u);
                        setFormOpen(true);
                      }}
                      type="button"
                    >
                      {t('common.edit')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setLogTarget(u)} type="button">
                      {t('users.viewLog')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <UserFormModal open={formOpen} onClose={() => setFormOpen(false)} initial={editing} />
      )}

      {logTarget && (
        <UserLogModal user={logTarget} open={!!logTarget} onClose={() => setLogTarget(null)} />
      )}
    </div>
  );
}

interface FormProps {
  open: boolean;
  onClose: () => void;
  initial?: SafeUser | null;
}

function UserFormModal({ open, onClose, initial }: FormProps) {
  const { t } = useTranslation();
  const isEdit = !!initial;
  const toast = useToast();
  const qc = useQueryClient();

  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [role, setRole] = useState<Role>(initial?.role ?? 'VIEWER');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMut = useMutation({
    mutationFn: (p: CreateUserPayload) => usersApi.create(p),
    onSuccess: () => {
      toast.success(t('users.createdSuccess'));
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error(t('users.createFailed'), toApiError(err).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: UpdateUserPayload }) => usersApi.update(id, p),
    onSuccess: () => {
      toast.success(t('users.updatedSuccess'));
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error(t('users.updateFailed'), toApiError(err).message),
  });

  const pwdMut = useMutation({
    mutationFn: ({ id, pw }: { id: string; pw: string }) => usersApi.changePassword(id, pw),
    onSuccess: () => {
      toast.success(t('users.passwordChanged'));
      setChangePasswordOpen(false);
      setNewPassword('');
    },
    onError: (err) => toast.error(t('users.passwordChangeFailed'), toApiError(err).message),
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!email.trim()) e.email = t('users.validation.emailRequired');
    if (!isEdit && !password.trim()) e.password = t('users.validation.passwordRequired');
    if (!fullName.trim()) e.fullName = t('users.validation.fullNameRequired');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (isEdit && initial) {
      updateMut.mutate({
        id: initial.id,
        p: { fullName: fullName.trim(), role, isActive },
      });
    } else {
      createMut.mutate({ email: email.trim().toLowerCase(), password, fullName: fullName.trim(), role });
    }
  }

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('users.editTitle', { fullName: initial?.fullName }) : t('users.newTitle')}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button" disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="user-form" loading={submitting}>
            {isEdit ? t('common.save') : t('users.createUser')}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="fullName"
          label={t('users.fullName')}
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
        />
        <Input
          id="email"
          label={t('users.email')}
          type="email"
          required
          disabled={isEdit}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          hint={isEdit ? t('users.emailHint') : undefined}
        />
        {!isEdit && (
          <Input
            id="password"
            label={t('users.password')}
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint={t('users.passwordHint')}
          />
        )}
        <Select
          id="role"
          label={t('users.role')}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="ADMIN">{t('users.roleAdmin')}</option>
          <option value="WAREHOUSE_STAFF">{t('users.roleWarehouse')}</option>
          <option value="VIEWER">{t('users.roleViewer')}</option>
        </Select>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            {t('common.active')}
          </label>
        )}
      </form>

      {isEdit && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">{t('users.passwordSection')}</p>
              <p className="text-xs text-slate-500">{t('users.passwordSectionHint')}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setChangePasswordOpen(true)}
              type="button"
            >
              {t('users.changePassword')}
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        title={t('users.changePassword')}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setChangePasswordOpen(false)}
              type="button"
              disabled={pwdMut.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              loading={pwdMut.isPending}
              onClick={() => initial && pwdMut.mutate({ id: initial.id, pw: newPassword })}
              disabled={newPassword.length < 8}
            >
              {t('users.setPassword')}
            </Button>
          </>
        }
      >
        <Input
          id="newPassword"
          label={t('users.newPassword')}
          type="password"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          hint={t('users.passwordHint')}
        />
      </Modal>
    </Modal>
  );
}

function UserLogModal({
  user,
  open,
  onClose,
}: {
  user: SafeUser;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const logQ = useQuery({
    queryKey: ['audit-log', 'user', user.id, page],
    queryFn: () => auditLogApi.list({ userId: user.id, page, pageSize }),
    enabled: open,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('users.logTitle', { fullName: user.fullName })}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose} type="button">
          {t('common.close')}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-slate-500">{user.email}</p>
      <div className="table-wrap max-h-[420px] overflow-y-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t('activityLog.when')}</th>
              <th>{t('activityLog.action')}</th>
              <th>{t('activityLog.target')}</th>
            </tr>
          </thead>
          <tbody>
            {logQ.isLoading && (
              <tr>
                <td colSpan={3} className="py-8 text-center">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {logQ.data?.data.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap text-xs text-slate-600">
                  {formatDateTime(row.createdAt)}
                </td>
                <td>
                  <Badge tone={LOG_ACTION_TONE[row.action] ?? 'gray'}>
                    {t(`activityLog.actions.${row.action}`, { defaultValue: row.action })}
                  </Badge>
                </td>
                <td className="font-mono text-xs text-slate-600">
                  {row.target ?? t('common.emDash')}
                </td>
              </tr>
            ))}
            {logQ.data?.data.length === 0 && !logQ.isLoading && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-slate-400">
                  {t('users.logEmpty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {logQ.data && logQ.data.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
          <p>{t('common.pageOf', { page, totalPages: logQ.data.totalPages })}</p>
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
              disabled={page >= logQ.data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              type="button"
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
