import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../lib/auth-store';
import { cn } from '../lib/utils';
import type { Role } from '../lib/types';
import { Button } from './ui/Button';
import { ScanFab } from './ScanFab';

interface NavItem {
  to: string;
  labelKey: string;
  icon: string;
  roles?: Role[];
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', labelKey: 'layout.nav.dashboard', icon: '📊', end: true },
  { to: '/products', labelKey: 'layout.nav.products', icon: '📦' },
  { to: '/sites', labelKey: 'layout.nav.sites', icon: '🌐' },
  { to: '/import-export', labelKey: 'layout.nav.importExport', icon: '🗂️' },
  { to: '/sync', labelKey: 'layout.nav.sync', icon: '🔄' },
  { to: '/orders', labelKey: 'layout.nav.orders', icon: '🧾' },
  {
    to: '/logistics',
    labelKey: 'layout.nav.logistics',
    icon: '🚚',
    roles: ['ADMIN', 'WAREHOUSE_STAFF'],
  },
  { to: '/reports', labelKey: 'layout.nav.reports', icon: '📈' },
  { to: '/matching', labelKey: 'layout.nav.matching', icon: '🔗', roles: ['ADMIN', 'WAREHOUSE_STAFF'] },
  { to: '/compare', labelKey: 'layout.nav.compare', icon: '⚖️', roles: ['ADMIN', 'WAREHOUSE_STAFF', 'VIEWER'] },
  { to: '/activity-log', labelKey: 'layout.nav.activityLog', icon: '📋', roles: ['ADMIN'] },
  { to: '/users', labelKey: 'layout.nav.users', icon: '👥', roles: ['ADMIN'] },
];

export function Layout() {
  const { t } = useTranslation();
  const { user, clear } = useAuthStore();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, []);

  function handleLogout() {
    clear();
    navigate('/login', { replace: true });
  }

  const visibleNav = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  const navList = (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {visibleNav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setDrawerOpen(false)}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )
          }
        >
          <span className="text-base" aria-hidden="true">
            {item.icon}
          </span>
          <span>{t(item.labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );

  const userBlock = (
    <div className="border-t border-slate-100 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {user?.email?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{user?.email ?? '—'}</p>
          <p className="truncate text-xs text-slate-500">
            {user && t(`roles.${user.role}`)}
          </p>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3 w-full"
        onClick={handleLogout}
        type="button"
      >
        {t('layout.signOut')}
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-60 shrink-0 flex-col border-e border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <span className="text-sm font-bold">H</span>
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">{t('common.appName')}</p>
            <p className="text-[11px] text-slate-500">{t('layout.phaseLabel')}</p>
          </div>
        </div>
        {navList}
        <div className="mt-auto">{userBlock}</div>
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute start-0 top-0 flex h-full w-64 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <span className="text-sm font-bold">H</span>
                </div>
                <p className="text-sm font-semibold text-slate-900">{t('common.appName')}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrawerOpen(false)}
                aria-label={t('layout.closeMenu')}
                type="button"
              >
                ✕
              </Button>
            </div>
            {navList}
            <div className="mt-auto">{userBlock}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label={t('layout.openMenu')}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white">
              <span className="text-xs font-bold">H</span>
            </div>
            <p className="text-sm font-semibold text-slate-900">{t('common.appName')}</p>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 md:px-8 md:py-7 md:pb-28">
          <Outlet />
        </main>
        <ScanFab />
      </div>
    </div>
  );
}
