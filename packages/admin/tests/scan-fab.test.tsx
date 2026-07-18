import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ScanFab } from '../src/components/ScanFab';

vi.mock('../src/lib/api', () => ({
  productsApi: { lookup: vi.fn() },
}));

vi.mock('../src/lib/product-scan', () => ({
  resolveProductScan: vi.fn(),
}));

vi.mock('../src/lib/auth-store', () => ({
  useAuthStore: () => ({ user: { role: 'ADMIN', email: 'admin@hub.local' } }),
}));

vi.mock('../src/lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../src/components/products/BarcodeScannerModal', () => ({
  BarcodeScannerModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="scanner-modal">scanner</div> : null,
}));

describe('ScanFab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows create and scan options when + is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ScanFab />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /منوی سریع|openMenu/i }));

    expect(screen.getByRole('button', { name: /ایجاد محصول|createProduct/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /اسکن محصول|scanProduct/i })).toBeInTheDocument();
  });

  it('opens scanner when scan product is chosen', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ScanFab />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /منوی سریع|openMenu/i }));
    await user.click(screen.getByRole('button', { name: /اسکن محصول|scanProduct/i }));

    expect(screen.getByTestId('scanner-modal')).toBeInTheDocument();
  });
});
