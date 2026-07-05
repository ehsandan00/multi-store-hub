import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportExportPage } from '../src/pages/ImportExport';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';
import type { ImportPreview, SafeSite } from '../src/lib/types';

const site: SafeSite = {
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const preview: ImportPreview = {
  jobId: 'job-1',
  fileName: 'import.xlsx',
  status: 'PREVIEW',
  totalRows: 3,
  newCount: 1,
  updateCount: 1,
  errorCount: 1,
  errors: [{ row: 4, sku: 'BAD', message: 'Invalid base_price: "free"' }],
  rowsPreview: [
    { row: 2, skuMaster: 'EX', name: 'Existing', totalStock: 10, action: 'update' },
    { row: 3, skuMaster: 'NEW', name: 'New', totalStock: 5, basePrice: 9, action: 'create' },
  ],
};

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <ImportExportPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Import/Export page', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    vi.restoreAllMocks();
    // Default no-op mocks for the two list queries
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [site],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(apiModule.importExportApi, 'listJobs').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
  });

  it('renders the export section and the upload dropzone for admins', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument());
    expect(screen.getByText(/choose an \.xlsx file/i)).toBeInTheDocument();
    // Site dropdowns (filter + WooCommerce export) populate after the sites query resolves
    await waitFor(() =>
      expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0),
    );
  });

  it('hides the upload dropzone for viewers (read-only)', async () => {
    useAuthStore.setState({
      user: { id: 'u3', email: 'viewer@hub.local', role: 'VIEWER' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument());
    expect(screen.queryByText(/choose an \.xlsx file/i)).not.toBeInTheDocument();
  });

  it('shows a preview summary (new/update/errors) after a successful upload', async () => {
    const user = userEvent.setup();
    const uploadSpy = vi
      .spyOn(apiModule.importExportApi, 'uploadPreview')
      .mockResolvedValue(preview);

    renderPage();
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument());

    const file = new File(['fake'], 'import.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = screen.getByLabelText(/click to choose an \.xlsx file/i) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    // Error block is unique
    await waitFor(() => expect(screen.getByText(/Invalid base_price/i)).toBeInTheDocument());
    // Confirm button reflects the count of valid rows (1 new + 1 update = 2)
    expect(screen.getByRole('button', { name: /Confirm & import 2 row/i })).toBeInTheDocument();
    // Stat tiles present (New + Updates labels are uppercased in the Stat component)
    expect(screen.getByText(/^Updates$/i)).toBeInTheDocument();
  });

  it('disables the confirm button when every row has an error', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule.importExportApi, 'uploadPreview').mockResolvedValue({
      ...preview,
      newCount: 0,
      updateCount: 0,
      errorCount: 3,
      rowsPreview: [],
      errors: [
        { row: 2, sku: 'A', message: 'bad' },
        { row: 3, sku: 'B', message: 'bad' },
        { row: 4, sku: 'C', message: 'bad' },
      ],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Export')).toBeInTheDocument());
    const file = new File(['fake'], 'import.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const input = screen.getByLabelText(/click to choose an \.xlsx file/i) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() =>
      expect(screen.getByText(/Nothing to commit/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Confirm & import/i })).toBeDisabled();
  });
});
