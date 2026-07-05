import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi, toApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { useAuthStore } from '../lib/auth-store';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatDateTime } from '../lib/utils';
import type { CreateUserPayload, Role, SafeUser, UpdateUserPayload } from '../lib/types';

const ROLE_TONE: Record<Role, 'blue' | 'amber' | 'gray'> = {
  ADMIN: 'blue',
  WAREHOUSE_STAFF: 'amber',
  VIEWER: 'gray',
};

export function UsersPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { user: currentUser } = useAuthStore();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SafeUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SafeUser | null>(null);

  const listQ = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });

  const deleteMut = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      toast.success('User deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => toast.error('Failed to delete user', toApiError(err).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Users &amp; roles</h1>
          <p className="mt-1 text-sm text-slate-500">Admin-only. Role changes are audited.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + New user
        </Button>
      </div>

      {/* Mobile cards */}
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
              <Badge tone={ROLE_TONE[u.role]}>{u.role.replace('_', ' ')}</Badge>
            </div>
            <p className="mt-2 text-xs text-slate-400">Created {formatDateTime(u.createdAt)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setEditing(u); setFormOpen(true); }} type="button">
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:bg-rose-50"
                disabled={u.id === currentUser?.id}
                onClick={() => setDeleteTarget(u)}
                type="button"
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="table-wrap hidden md:block">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th className="text-right">Actions</th>
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
                <td><Badge tone={ROLE_TONE[u.role]}>{u.role.replace('_', ' ')}</Badge></td>
                <td>
                  {u.isActive ? <Badge tone="green">active</Badge> : <Badge tone="gray">inactive</Badge>}
                </td>
                <td>{formatDateTime(u.createdAt)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { setEditing(u); setFormOpen(true); }}
                      type="button"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:bg-rose-50"
                      disabled={u.id === currentUser?.id}
                      onClick={() => setDeleteTarget(u)}
                      type="button"
                      title={u.id === currentUser?.id ? 'You cannot delete yourself' : undefined}
                    >
                      Delete
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete user"
        message={
          <>
            Delete <strong>{deleteTarget?.fullName}</strong> ({deleteTarget?.email})? This is
            audited and cannot be undone.
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

interface FormProps {
  open: boolean;
  onClose: () => void;
  initial?: SafeUser | null;
}

function UserFormModal({ open, onClose, initial }: FormProps) {
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
      toast.success('User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error('Failed to create user', toApiError(err).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: UpdateUserPayload }) => usersApi.update(id, p),
    onSuccess: () => {
      toast.success('User updated');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error('Failed to update user', toApiError(err).message),
  });

  const pwdMut = useMutation({
    mutationFn: ({ id, pw }: { id: string; pw: string }) => usersApi.changePassword(id, pw),
    onSuccess: () => {
      toast.success('Password changed');
      setChangePasswordOpen(false);
      setNewPassword('');
    },
    onError: (err) => toast.error('Failed to change password', toApiError(err).message),
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!email.trim()) e.email = 'Email is required';
    if (!isEdit && !password.trim()) e.password = 'Password is required (≥ 8 chars)';
    if (!fullName.trim()) e.fullName = 'Full name is required';
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
      title={isEdit ? `Edit ${initial?.fullName}` : 'New user'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button" disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={submitting}>
            {isEdit ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="fullName"
          label="Full name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
        />
        <Input
          id="email"
          label="Email"
          type="email"
          required
          disabled={isEdit}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          hint={isEdit ? 'Email cannot be changed' : undefined}
        />
        {!isEdit && (
          <Input
            id="password"
            label="Password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint="Minimum 8 characters"
          />
        )}
        <Select
          id="role"
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="ADMIN">Admin — full access</option>
          <option value="WAREHOUSE_STAFF">Warehouse staff — inventory only</option>
          <option value="VIEWER">Viewer — read-only</option>
        </Select>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Active
          </label>
        )}
      </form>

      {isEdit && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Password</p>
              <p className="text-xs text-slate-500">Set a new password for this user.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setChangePasswordOpen(true)}
              type="button"
            >
              Change password
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        title="Change password"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setChangePasswordOpen(false)}
              type="button"
              disabled={pwdMut.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={pwdMut.isPending}
              onClick={() => initial && pwdMut.mutate({ id: initial.id, pw: newPassword })}
              disabled={newPassword.length < 8}
            >
              Set password
            </Button>
          </>
        }
      >
        <Input
          id="newPassword"
          label="New password"
          type="password"
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          hint="Minimum 8 characters"
        />
      </Modal>
    </Modal>
  );
}
