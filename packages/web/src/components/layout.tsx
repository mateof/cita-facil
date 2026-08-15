import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  CalendarSync,
  Palette,
  BarChart3,
  CalendarDays,
  CalendarRange,
  Cog,
  Globe,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Plug,
  Server,
  ShieldCheck,
  Ticket,
  Users,
  UserCircle2,
  Wrench,
  Bell,
  Building2,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { isReservedSlug } from '@cita-facil/shared';
import { api } from '../lib/api.ts';
import type { PublicOrganization } from '../lib/types.ts';
import { useAuth } from '../stores/auth.ts';
import {
  forgetOrganization,
  organizationFromPath,
  rememberOrganization,
} from '../stores/organization-context.ts';
import { useOrganizationTheme } from './theme.tsx';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../i18n/index.ts';
import FirstOrganization from './FirstOrganization.tsx';
import { HeaderBrand } from './header-brand.tsx';

/** Selector de idioma. Presente en todas las pantallas, también sin sesión. */
export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const current = i18n.language.slice(0, 2);

  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      <Globe className="size-4" aria-hidden />
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={current}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        className={clsx(
          'cursor-pointer rounded-lg border-0 bg-transparent py-1 pr-6 text-sm font-medium outline-none focus:ring-2 focus:ring-brand/30',
          compact && 'text-xs',
        )}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Contenedor del portal de cliente. La navegación va en una barra inferior
 * fija, que es donde llega el pulgar en un móvil, y pasa a barra superior en
 * pantallas grandes.
 */
export function CustomerLayout() {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const isStaff = useAuth((state) => state.isStaff());
  const logout = useAuth((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();

  /*
   * El aspecto del negocio se aplica aquí y no en la página de reservas porque
   * "Mis citas", "Mis bonos" y "Perfil" son pantallas comunes que no llevan el
   * negocio en la dirección: aplicándolo solo allí, el cliente perdía el tema y
   * el nombre en cuanto salía de la reserva.
   */
  const slug = organizationFromPath(location.pathname);

  useEffect(() => {
    const enLaRuta = location.pathname.split('/')[1] ?? '';
    if (enLaRuta && !isReservedSlug(enLaRuta)) {
      rememberOrganization(enLaRuta);
    } else if (location.pathname === '/') {
      // La portada es de la instalación, no de ningún negocio.
      forgetOrganization();
    }
  }, [location.pathname]);

  const organizacion = useQuery({
    enabled: Boolean(slug),
    queryKey: ['public-org', slug],
    queryFn: () => api.get<PublicOrganization>(`/public/organizations/${slug}`),
  });

  useOrganizationTheme(organizacion.data?.theme);

  const items = [
    { to: '/', label: t('nav.book'), icon: Home, end: true },
    { to: '/mis-citas', label: t('nav.myAppointments'), icon: CalendarDays },
    // Los bonos solo tienen sentido con sesión iniciada: sin cuenta no hay
    // saldo que enseñar.
    ...(user ? [{ to: '/mis-bonos', label: t('nav.credits'), icon: Ticket }] : []),
    { to: '/perfil', label: t('nav.profile'), icon: UserCircle2 },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <HeaderBrand />

          <nav className="hidden items-center gap-1 sm:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'rounded-lg px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-brand-soft text-brand' : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            {isStaff && (
              <NavLink
                to="/admin"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                {t('nav.admin')}
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            {user ? (
              <button
                type="button"
                onClick={() => void logout().then(() => navigate('/'))}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label={t('common.logout')}
              >
                <LogOut className="size-5" />
              </button>
            ) : (
              <NavLink to="/entrar" className="btn-primary px-3 py-1.5 text-sm">
                {t('auth.signIn')}
              </NavLink>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-5 pb-24 sm:pb-8">
        <Outlet />
      </main>

      {/* Navegación inferior, solo en móvil. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden">
        <div className="flex" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium',
                  isActive ? 'text-brand' : 'text-slate-500',
                )
              }
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
          {isStaff && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium',
                  isActive ? 'text-brand' : 'text-slate-500',
                )
              }
            >
              <LayoutGrid className="size-5" aria-hidden />
              {t('nav.admin')}
            </NavLink>
          )}
        </div>
      </nav>
    </div>
  );
}

/**
 * Contenedor del panel de administración. Pensado para ordenador o tableta,
 * con menú lateral fijo, pero plegable en móvil para que siga siendo usable
 * desde el teléfono cuando hace falta.
 */
export function AdminLayout() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useAuth((state) => state.user);
  const can = useAuth((state) => state.can);
  const organizations = useAuth((state) => state.organizations);
  const organizationsLoaded = useAuth((state) => state.organizationsLoaded);
  const activeOrganizationId = useAuth((state) => state.activeOrganizationId);
  const setActiveOrganization = useAuth((state) => state.setActiveOrganization);
  const logout = useAuth((state) => state.logout);
  const navigate = useNavigate();

  const activeOrganization = organizations.find((item) => item.id === activeOrganizationId);

  const sections: { to: string; label: string; icon: typeof Home; visible: boolean }[] = [
    { to: '/admin', label: t('nav.dashboard'), icon: Home, visible: true },
    { to: '/admin/agenda', label: t('nav.agenda'), icon: CalendarRange, visible: true },
    { to: '/admin/citas', label: t('nav.appointments'), icon: CalendarDays, visible: true },
    { to: '/admin/servicios', label: t('nav.services'), icon: LayoutGrid, visible: can('service:read') },
    { to: '/admin/bonos', label: t('nav.credits'), icon: Ticket, visible: can('credit:read') },
    { to: '/admin/recursos', label: t('nav.resources'), icon: Wrench, visible: can('resource:read') },
    { to: '/admin/horarios', label: t('nav.schedules'), icon: CalendarRange, visible: can('schedule:read') },
    { to: '/admin/programaciones', label: t('nav.recurring'), icon: CalendarSync, visible: can('appointment:read') },
    { to: '/admin/equipo', label: t('nav.team'), icon: Users, visible: can('member:read') },
    { to: '/admin/informes', label: t('nav.reports'), icon: BarChart3, visible: can('report:read') },
    { to: '/admin/avisos', label: t('nav.notifications'), icon: Bell, visible: can('notification:read') },
    { to: '/admin/integraciones', label: t('nav.integrations'), icon: Plug, visible: can('integration:read') },
    { to: '/admin/temas', label: t('nav.themes'), icon: Palette, visible: can('settings:read') },
    { to: '/admin/ajustes', label: t('nav.settings'), icon: Cog, visible: can('settings:read') },
    {
      to: '/admin/organizaciones',
      label: t('nav.organizations'),
      icon: Building2,
      visible: user?.platformRole === 'superadmin',
    },
    {
      to: '/admin/acceso',
      label: t('nav.access'),
      icon: ShieldCheck,
      visible: user?.platformRole === 'superadmin',
    },
    {
      to: '/admin/sistema',
      label: t('nav.system'),
      icon: Server,
      visible: user?.platformRole === 'superadmin',
    },
  ];

  const visible = sections.filter((section) => section.visible);

  const nav = (
    <nav className="space-y-0.5">
      {visible.map((section) => (
        <NavLink
          key={section.to}
          to={section.to}
          end={section.to === '/admin'}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100',
            )
          }
        >
          <section.icon className="size-4.5 shrink-0" aria-hidden />
          {section.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-4 lg:block">
        <NavLink to="/" className="mb-5 block text-lg font-bold text-brand">
          {t('common.appName')}
        </NavLink>

        {organizations.length > 1 && (
          <select
            value={activeOrganizationId ?? ''}
            onChange={(event) => setActiveOrganization(event.target.value)}
            className="input mb-4 text-sm"
            aria-label={t('admin.access.organization')}
          >
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}

        {nav}

        <div className="mt-6 border-t border-slate-200 pt-4">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => void logout().then(() => navigate('/'))}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="size-4.5" aria-hidden />
            {t('common.logout')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 hover:bg-slate-100"
            aria-label={t('nav.admin')}
          >
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">{activeOrganization?.name ?? t('nav.admin')}</span>
          <NavLink to="/" className="rounded-lg p-2 hover:bg-slate-100" aria-label={t('nav.book')}>
            <Home className="size-5" />
          </NavLink>
        </header>

        {menuOpen && (
          <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setMenuOpen(false)}>
            <div
              className="h-full w-72 overflow-y-auto bg-white p-4"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="text-lg font-bold text-brand">{t('common.appName')}</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg p-2 hover:bg-slate-100"
                  aria-label={t('common.close')}
                >
                  <X className="size-5" />
                </button>
              </div>
              {organizations.length > 1 && (
                <select
                  value={activeOrganizationId ?? ''}
                  onChange={(event) => setActiveOrganization(event.target.value)}
                  className="input mb-4 text-sm"
                >
                  {organizations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
              {nav}
              <div className="mt-6 border-t border-slate-200 pt-4">
                <LanguageSwitcher />
              </div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          {/*
            Sin organización activa, todas las pantallas del panel se quedarían
            esperando datos que nunca llegan. Se resuelve una sola vez aquí en
            lugar de repetir la comprobación en cada pantalla.
          */}
          {organizationsLoaded && organizations.length === 0 ? (
            <FirstOrganization />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}

/** Contenedor centrado para las pantallas de acceso. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex justify-end p-4">
        <LanguageSwitcher compact />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          <NavLink to="/" className="mb-6 block text-center text-2xl font-bold text-brand">
            {t('common.appName')}
          </NavLink>
          {children}
        </div>
      </div>
    </div>
  );
}
