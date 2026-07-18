import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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

function buildForm(site?: SafeSite | null): CreateSitePayload {
  return site
    ? {
        name: site.name,
        baseUrl: site.baseUrl,
        consumerKey: '',
        consumerSecret: '',
        networkRoute: site.networkRoute,
        isActive: site.isActive,
      }
    : { ...EMPTY };
}

export function SiteFormModal({ open, onClose, initial }: Props) {
  const { t } = useTranslation();
  const isEdit = !!initial;
  const toast = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState<CreateSitePayload>(() => buildForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm(buildForm(initial));
    setErrors({});
  }, [open, initial?.id, initial?.networkRoute, initial?.name, initial?.baseUrl, initial?.isActive]);

  function set<K extends keyof CreateSitePayload>(key: K, value: CreateSitePayload[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = t('sites.validation.nameRequired');
    if (!form.baseUrl.trim()) e.baseUrl = t('sites.validation.baseUrlRequired');
    else if (!/^https?:\/\//i.test(form.baseUrl.trim()))
      e.baseUrl = t('sites.validation.baseUrlFormat');
    if (!isEdit) {
      if (!form.consumerKey.trim()) e.consumerKey = t('sites.validation.consumerKeyRequired');
      if (!form.consumerSecret.trim()) e.consumerSecret = t('sites.validation.consumerSecretRequired');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const createMut = useMutation({
    mutationFn: (p: CreateSitePayload) => sitesApi.create(p),
    onSuccess: () => {
      toast.success(t('sites.createdSuccess'));
      qc.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
    onError: (err) => toast.error(t('sites.createFailed'), toApiError(err).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: UpdateSitePayload }) => sitesApi.update(id, p),
    onSuccess: () => {
      toast.success(t('sites.updatedSuccess'));
      qc.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
    onError: (err) => toast.error(t('sites.updateFailed'), toApiError(err).message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (isEdit && initial) {
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
      title={isEdit ? t('sites.editTitle', { name: initial?.name }) : t('sites.addTitle')}
      description={isEdit ? t('sites.descEdit') : t('sites.descNew')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button" disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="site-form" loading={submitting}>
            {isEdit ? t('common.save') : t('sites.saveSite')}
          </Button>
        </>
      }
    >
      <form id="site-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          id="name"
          label={t('sites.displayName')}
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <Input
          id="baseUrl"
          label={t('sites.baseUrl')}
          required
          value={form.baseUrl}
          onChange={(e) => set('baseUrl', e.target.value)}
          error={errors.baseUrl}
          placeholder="https://store.example.ir"
        />
        <Input
          id="consumerKey"
          label={isEdit ? t('sites.consumerKeyEdit') : t('sites.consumerKey')}
          required={!isEdit}
          value={form.consumerKey}
          onChange={(e) => set('consumerKey', e.target.value)}
          error={errors.consumerKey}
          placeholder="ck_xxxxxxxxxxxxxxxxxxxx"
        />
        <Input
          id="consumerSecret"
          label={isEdit ? t('sites.consumerSecretEdit') : t('sites.consumerSecret')}
          required={!isEdit}
          type="password"
          value={form.consumerSecret}
          onChange={(e) => set('consumerSecret', e.target.value)}
          error={errors.consumerSecret}
          placeholder="cs_xxxxxxxxxxxxxxxxxxxx"
        />
        <div className="sm:col-span-2">
          <label className="label">{t('sites.networkRoute')}</label>
          <div className="grid grid-cols-2 gap-2">
            {(['VIA_FOREIGN_PROXY', 'DIRECT'] as NetworkRoute[]).map((route) => (
              <button
                key={route}
                type="button"
                onClick={() => set('networkRoute', route)}
                className={
                  'rounded-lg border px-3 py-2 text-start text-sm font-medium transition-colors ' +
                  (form.networkRoute === route
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
                }
              >
                <div className="text-xs uppercase tracking-wide opacity-70">
                  {route === 'DIRECT' ? t('sites.groupB') : t('sites.groupA')}
                </div>
                <div className="mt-0.5">
                  {route === 'DIRECT' ? t('sites.routeDirect') : t('sites.routeProxy')}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {form.networkRoute === 'DIRECT'
              ? t('sites.routeDirectHint')
              : t('sites.routeProxyHint')}
          </p>
          <p className="mt-1 text-xs text-slate-400">{t('sites.proxyEnvHint')}</p>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            {t('common.active')}
          </label>
        </div>
      </form>
    </Modal>
  );
}
