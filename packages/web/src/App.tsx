import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from './stores/auth.ts';
import { AdminLayout, CustomerLayout } from './components/layout.tsx';
import { Spinner } from './components/ui.tsx';

import Home from './pages/Home.tsx';
import Book from './pages/Book.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/PasswordRecovery.tsx';
import Activate from './pages/Activate.tsx';
import MyAppointments from './pages/MyAppointments.tsx';
import MyCredits from './pages/MyCredits.tsx';
import AppointmentDetail from './pages/AppointmentDetail.tsx';
import Profile from './pages/Profile.tsx';
import Lookup from './pages/Lookup.tsx';
import OrganizationPage from './pages/OrganizationPage.tsx';

import Dashboard from './pages/admin/Dashboard.tsx';
import Agenda from './pages/admin/Agenda.tsx';
import AdminAppointments from './pages/admin/Appointments.tsx';
import Services from './pages/admin/Services.tsx';
import Resources from './pages/admin/Resources.tsx';
import Schedules from './pages/admin/Schedules.tsx';
import Team from './pages/admin/Team.tsx';
import Reports from './pages/admin/Reports.tsx';
import AdminNotifications from './pages/admin/Notifications.tsx';
import Integrations from './pages/admin/Integrations.tsx';
import Settings from './pages/admin/Settings.tsx';
import Credits from './pages/admin/Credits.tsx';
import System from './pages/admin/System.tsx';
import Access from './pages/admin/Access.tsx';
import Organizations from './pages/admin/Organizations.tsx';
import Themes from './pages/admin/Themes.tsx';
import Recurring from './pages/admin/Recurring.tsx';

/** Exige sesión iniciada; si no la hay, manda a la pantalla de acceso. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuth((state) => state.user);
  const ready = useAuth((state) => state.ready);
  const location = useLocation();

  if (!ready) return <FullScreenLoader />;
  if (!user) {
    return <Navigate to={`/entrar?volver=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

/** Exige pertenecer a alguna organización para entrar en el panel. */
function RequireStaff({ children }: { children: React.ReactNode }) {
  const ready = useAuth((state) => state.ready);
  const isStaff = useAuth((state) => state.isStaff());
  const user = useAuth((state) => state.user);
  const location = useLocation();

  if (!ready) return <FullScreenLoader />;
  if (!user) {
    return <Navigate to={`/entrar?volver=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (!isStaff) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * `/reservar/<slug>` era la dirección anterior de la página de un
 * establecimiento. Se mantiene redirigiendo para que no se rompan los enlaces
 * ya enviados por correo ni los QR impresos.
 */
function RedirectToOrganization() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const resto = location.pathname.replace(`/reservar/${slug}`, '');
  return <Navigate to={`/${slug}${resto}${location.search}`} replace />;
}

function FullScreenLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <span className="flex items-center gap-2 text-slate-500">
        <Spinner />
        {t('common.loading')}
      </span>
    </div>
  );
}

export default function App() {
  const bootstrap = useAuth((state) => state.bootstrap);
  const ready = useAuth((state) => state.ready);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!ready) return <FullScreenLoader />;

  return (
    <Routes>
      {/* Acceso y recuperación: sin contenedor de aplicación. */}
      <Route path="/entrar" element={<Login />} />
      <Route path="/registro" element={<Register />} />
      <Route path="/recuperar" element={<ForgotPassword />} />
      <Route path="/nueva-contrasena" element={<ResetPassword />} />
      <Route path="/verificar-correo" element={<VerifyEmail />} />
      <Route path="/activar" element={<Activate />} />

      {/* Portal de cliente. */}
      <Route element={<CustomerLayout />}>
        <Route index element={<Home />} />
        <Route path="/consultar" element={<Lookup />} />
        <Route
          path="/mis-citas"
          element={
            <RequireAuth>
              <MyAppointments />
            </RequireAuth>
          }
        />
        <Route
          path="/mis-bonos"
          element={
            <RequireAuth>
              <MyCredits />
            </RequireAuth>
          }
        />
        <Route
          path="/citas/:id"
          element={
            <RequireAuth>
              <AppointmentDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/perfil"
          element={
            <RequireAuth>
              <Profile />
            </RequireAuth>
          }
        />

        {/*
          Cada organización vive en la raíz: /peluqueria, /gimnasio. Va al final
          porque es el patrón más general, aunque el enrutador da prioridad a
          los segmentos fijos y no haría falta el orden. Los nombres que chocan
          con estas pantallas están reservados y no se pueden asignar a una
          organización (ver RESERVED_SLUGS).
        */}
        <Route path="/:slug" element={<Book />} />
        <Route path="/:slug/contacto" element={<OrganizationPage pageKey="contact" />} />
        <Route path="/:slug/sobre-nosotros" element={<OrganizationPage pageKey="about" />} />

        {/* Las direcciones antiguas siguen funcionando. */}
        <Route path="/reservar/:slug/*" element={<RedirectToOrganization />} />
        <Route path="/reservar/:slug" element={<RedirectToOrganization />} />
      </Route>

      {/* Panel de administración. */}
      <Route
        path="/admin"
        element={
          <RequireStaff>
            <AdminLayout />
          </RequireStaff>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="citas" element={<AdminAppointments />} />
        <Route path="servicios" element={<Services />} />
        <Route path="bonos" element={<Credits />} />
        <Route path="recursos" element={<Resources />} />
        <Route path="horarios" element={<Schedules />} />
        <Route path="equipo" element={<Team />} />
        <Route path="informes" element={<Reports />} />
        <Route path="avisos" element={<AdminNotifications />} />
        <Route path="integraciones" element={<Integrations />} />
        <Route path="ajustes" element={<Settings />} />
        <Route path="programaciones" element={<Recurring />} />
        <Route path="temas" element={<Themes />} />
        <Route path="organizaciones" element={<Organizations />} />
        <Route path="acceso" element={<Access />} />
        <Route path="sistema" element={<System />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
