import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SitesList } from '../src/pages/Sites/List';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';
import type { SafeSite } from '../src/lib/types';

const sampleSite: SafeSite = {
  id: 's1',
  name: 'Demo IR store',
  baseUrl: 'https://demo.example.ir',
  consumerKeyMasked: '••••key1',
  consumerSecretMasked: '••••sec1',
  networkRoute: 'DIRECT',
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderList() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <SitesList />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Sites list', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    vi.restoreAllMocks();
  });

  it('renders the site row and a Test button', async () => {
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [sampleSite],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    renderList();
    // Both the mobile card and the desktop table render the site name; assert at least one.
    await waitFor(() =>
      expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0),
    );
    // The desktop table's Test button has the exact label "Test" (the mobile card uses "Test connection").
    expect(screen.getByRole('button', { name: /^test$/i })).toBeInTheDocument();
  });

  it('shows a success result with latency + route after a successful test', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [sampleSite],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const testSpy = vi.spyOn(apiModule.sitesApi, 'testConnection').mockResolvedValue({
      ok: true,
      latencyMs: 187,
      routeUsed: 'DIRECT',
      attempts: 1,
      status: 200,
    });

    renderList();
    await waitFor(() =>
      expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0),
    );

    await user.click(screen.getByRole('button', { name: /^test$/i }));

    await waitFor(() => expect(testSpy).toHaveBeenCalledWith('s1'));
    // Toast + desktop row + mobile card all surface success; assert at least one shows OK + latency.
    await waitFor(() =>
      expect(screen.getAllByText(/^OK$/i).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/187ms/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/DIRECT/).length).toBeGreaterThan(0);
  });

  it('shows a failure result when the test fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [sampleSite],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(apiModule.sitesApi, 'testConnection').mockResolvedValue({
      ok: false,
      latencyMs: 0,
      routeUsed: 'DIRECT',
      attempts: 3,
      error: { code: 'TIMEOUT', message: 'Request timed out' },
    });

    renderList();
    await waitFor(() =>
      expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0),
    );

    await user.click(screen.getByRole('button', { name: /^test$/i }));

    await waitFor(() => expect(screen.getByText(/^fail$/i)).toBeInTheDocument());
    expect(screen.getByText(/^TIMEOUT$/i)).toBeInTheDocument();
  });
});
