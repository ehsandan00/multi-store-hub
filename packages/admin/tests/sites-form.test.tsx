import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SiteFormModal } from '../src/pages/Sites/Form';
import { ToastProvider } from '../src/lib/toast';
import * as apiModule from '../src/lib/api';
import type { SafeSite } from '../src/lib/types';

const directSite: SafeSite = {
  id: 's1',
  name: 'Demo IR store',
  baseUrl: 'https://demo.example.ir',
  consumerKeyMasked: '••••key1',
  consumerSecretMasked: '••••sec1',
  networkRoute: 'DIRECT',
  isActive: true,
  syncEnabled: false,
  syncIntervalMs: 600_000,
  lastSyncAt: null,
  orderPullEnabled: false,
  lastOrderPullAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const proxySite: SafeSite = {
  ...directSite,
  id: 's2',
  name: 'Demo Foreign store',
  baseUrl: 'https://demo.example.com',
  networkRoute: 'VIA_FOREIGN_PROXY',
};

function renderForm(initial: SafeSite | null, onClose = vi.fn()) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <SiteFormModal open initial={initial} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('SiteFormModal network route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows proxy selected for a VIA_FOREIGN_PROXY site', () => {
    renderForm(proxySite);
    expect(screen.getByRole('button', { name: /پروکسی خارج/i })).toHaveClass('border-brand-500');
  });

  it('shows direct selected for a DIRECT site', () => {
    renderForm(directSite);
    expect(screen.getByRole('button', { name: /مستقیم \(سرور ایران\)/i })).toHaveClass(
      'border-brand-500',
    );
  });

  it('saves networkRoute when switching to proxy on edit', async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(apiModule.sitesApi, 'update').mockResolvedValue({
      ...directSite,
      networkRoute: 'VIA_FOREIGN_PROXY',
    });

    renderForm(directSite);
    await user.click(screen.getByRole('button', { name: /پروکسی خارج/i }));
    await user.click(screen.getByRole('button', { name: /ذخیره تغییرات/i }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith('s1', expect.objectContaining({
        networkRoute: 'VIA_FOREIGN_PROXY',
      })),
    );
  });
});
