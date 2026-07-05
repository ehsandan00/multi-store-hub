import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sitesApi, toApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import type { CreateSitePayload, NetworkRoute, SafeSite, UpdateSitePayload } from '../../lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: SafeSite | null;
}

const EMPTY: CreateSitePayload = {
  name: '',
  baseUrl: '',
  consumerKey: '',
  consumerSecret: '',
  networkRoute: 'DIRECT',
  isActive: true,
};

export function SiteFormModal({ open, onClose, initial }: Props) {
  const isEdit = !!initial;
  const toast = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState<CreateSitePayload>(() =>
    initial
      ? {
          name: initial.name,
          baseUrl: initial.baseUrl,
          // Don't prefill credentials — backend masks them; user must re-enter to change.
          consumerKey: '',
          consumerSecret: '',
          networkRoute: initial.networkRoute,
          isActive: initial.isActive,
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof CreateSitePayload>(key: K, value: CreateSitePayload[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.baseUrl.trim()) e.baseUrl = 'Base URL is required';
    else if (!/^https?:\/\//i.test(form.baseUrl.trim()))
      e.baseUrl = 'Must start with http:// or https://';
    if (!isEdit) {
      if (!form.consumerKey.trim()) e.consumerKey = 'Consumer key is required';
      if (!form.consumerSecret.trim()) e.consumerSecret = 'Consumer secret is required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const createMut = useMutation({
    mutationFn: (p: CreateSitePayload) => sitesApi.create(p),
    onSuccess: () => {
      toast.success('Site created');
      qc.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
    onError: (err) => toast.error('Failed to create site', toApiError(err).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: UpdateSitePayload }) => sitesApi.update(id, p),
    onSuccess: () => {
      toast.success('Site updated');
      qc.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
    onError: (err) => toast.error('Failed to update site', toApiError(err).message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (isEdit && initial) {
      // Only send credentials if the user entered new ones.
      const payload: UpdateSitePayload = {
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        networkRoute: form.networkRoute,
        isActive: form.isActive,
        ...(form.consumerKey.trim() ? { consumerKey: form.consumerKey.trim() } : {}),
        ...(form.consumerSecret.trim() ? { consumerSecret: form.consumerSecret.trim() } : {}),
      };
      updateMut.mutate({ id: initial.id, p: payload });
    } else {
      createMut.mutate({
        ...form,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        consumerKey: form.consumerKey.trim(),
        consumerSecret: form.consumerSecret.trim(),
      });
    }
  }

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${initial?.name}` : 'Add site'}
      description={
        isEdit
          ? 'Update site settings. Leave credential fields blank to keep existing values.'
          : 'Configure a WooCommerce store. Credentials are encrypted at rest (AES-256-GCM).'
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button" disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="site-form" loading={submitting}>
            {isEdit ? 'Save changes' : 'Add site'}
          </Button>
        </>
      }
    >
      <form id="site-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          id="name"
          label="Display name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="IR-hosted store"
        />
        <Input
          id="baseUrl"
          label="Base URL"
          required
          value={form.baseUrl}
          onChange={(e) => set('baseUrl', e.target.value)}
          error={errors.baseUrl}
          placeholder="https://store.example.ir"
        />
        <Input
          id="consumerKey"
          label={isEdit ? 'Consumer key (leave blank to keep)' : 'Consumer key'}
          required={!isEdit}
          value={form.consumerKey}
          onChange={(e) => set('consumerKey', e.target.value)}
          error={errors.consumerKey}
          placeholder="ck_xxxxxxxxxxxxxxxxxxxx"
        />
        <Input
          id="consumerSecret"
          label={isEdit ? 'Consumer secret (leave blank to keep)' : 'Consumer secret'}
          required={!isEdit}
          type="password"
          value={form.consumerSecret}
          onChange={(e) => set('consumerSecret', e.target.value)}
          error={errors.consumerSecret}
          placeholder="cs_xxxxxxxxxxxxxxxxxxxx"
        />
        <div>
          <label className="label">Network route</label>
          <div className="grid grid-cols-2 gap-2">
            {(['DIRECT', 'VIA_FOREIGN_PROXY'] as NetworkRoute[]).map((route) => (
              <button
                key={route}
                type="button"
                onClick={() => set('networkRoute', route)}
                className={
                  'rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' +
                  (form.networkRoute === route
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
                }
              >
                <div className="text-xs uppercase tracking-wide opacity-70">
                  {route === 'DIRECT' ? 'Group B' : 'Group A'}
                </div>
                <div className="mt-0.5">
                  {route === 'DIRECT'
                    ? 'Direct (IR host)'
                    : 'Via foreign proxy'}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {form.networkRoute === 'DIRECT'
              ? 'Use for IR-hosted sites that reject foreign IPs.'
              : 'Use for censored sites only reachable from a non-Iranian IP.'}
          </p>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Active
          </label>
        </div>
      </form>
    </Modal>
  );
}
