import { create } from 'zustand';
import { api, refresh, setAccessToken } from '../lib/api.ts';
import type { LoginResponse, Membership, SessionUser } from '../lib/types.ts';
import i18n from '../i18n/index.ts';

/**
 * Estado de sesión.
 *
 * `bootstrap()` se llama una vez al arrancar: intenta renovar la sesión con la
 * cookie de refresco y, si funciona, carga el perfil. Mientras tanto la
 * aplicación muestra un estado de carga, para no parpadear entre "no
 * identificado" e "identificado" en cada recarga.
 */

/** Organización que la persona puede administrar desde el panel. */
export interface ManageableOrganization {
  id: string;
  name: string;
  slug: string;
}

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  /** Organización sobre la que se está trabajando en el panel. */
  activeOrganizationId: string | null;
  /**
   * Organizaciones disponibles en el selector del panel. Para casi todo el
   * mundo son sus pertenencias, pero el administrador de la instalación puede
   * entrar en cualquiera aunque no pertenezca a ninguna, y sin esta lista el
   * panel se quedaba sin organización activa y en blanco.
   */
  organizations: ManageableOrganization[];
  organizationsLoaded: boolean;

  bootstrap: () => Promise<void>;
  login: (email: string, password: string, mfaCode?: string) => Promise<LoginResponse>;
  completeMfa: (params: {
    challengeId: string;
    method: string;
    code: string;
    rememberDevice?: boolean;
  }) => Promise<void>;
  loginWithCertificate: () => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    phone?: string;
    acceptTerms: true;
  }) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  setActiveOrganization: (organizationId: string) => void;
  /** Recarga la lista de organizaciones administrables. */
  loadOrganizations: () => Promise<void>;

  /** Organización activa resuelta, con su rol y permisos. */
  membership: () => Membership | null;
  can: (permission: string) => boolean;
  isStaff: () => boolean;
}

const ACTIVE_ORG_KEY = 'cf_active_org';

function applySession(set: (partial: Partial<AuthState>) => void, user: SessionUser): void {
  const stored = localStorage.getItem(ACTIVE_ORG_KEY);
  const own = user.memberships.map((membership) => ({
    id: membership.organizationId,
    name: membership.organizationName,
    slug: membership.organizationSlug,
  }));
  const valid = own.some((organization) => organization.id === stored);

  /*
   * El superadministrador de la instalación entra en organizaciones a las que
   * no pertenece, y esas no vienen en `memberships`: llegan después, con
   * `loadOrganizations`. Descartar aquí la guardada por no estar entre sus
   * pertenencias le devolvía al panel de otro negocio durante ese hueco, y las
   * pantallas que ya habían pedido datos se quedaban con los del negocio
   * equivocado. Se conserva y la valida `loadOrganizations` contra la lista
   * completa, que es quien puede hacerlo.
   */
  const conserva = valid || (stored !== null && user.platformRole === 'superadmin');
  const active = conserva ? stored : (own[0]?.id ?? null);

  if (user.locale && i18n.language.slice(0, 2) !== user.locale) {
    void i18n.changeLanguage(user.locale);
  }

  set({
    user,
    organizations: own,
    // El superadministrador puede no pertenecer a ninguna organización, así que
    // su lista se completa después con una consulta al API.
    organizationsLoaded: user.platformRole !== 'superadmin',
    activeOrganizationId: active,
    ready: true,
  });
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  activeOrganizationId: null,
  organizations: [],
  organizationsLoaded: false,

  bootstrap: async () => {
    const renewed = await refresh();
    if (!renewed) {
      set({ user: null, ready: true });
      return;
    }
    try {
      const user = await api.get<SessionUser>('/me');
      applySession(set, user);
      await get().loadOrganizations();
    } catch {
      set({ user: null, ready: true });
    }
  },

  login: async (email, password, mfaCode) => {
    const response = await api.post<LoginResponse>('/auth/login', { email, password, mfaCode });
    if (response.status === 'authenticated') {
      setAccessToken(response.tokens.accessToken);
      applySession(set, response.user);
      await get().loadOrganizations();
    }
    return response;
  },

  completeMfa: async ({ challengeId, method, code, rememberDevice }) => {
    const response = await api.post<{ tokens: { accessToken: string }; user: SessionUser }>(
      '/auth/mfa/verify',
      { challengeId, method, code, rememberDevice },
    );
    setAccessToken(response.tokens.accessToken);
    applySession(set, response.user);
  },

  loginWithCertificate: async () => {
    const response = await api.post<{ tokens: { accessToken: string }; user: SessionUser }>(
      '/auth/certificate',
    );
    setAccessToken(response.tokens.accessToken);
    applySession(set, response.user);
  },

  register: async (input) => {
    const response = await api.post<{ tokens: { accessToken: string }; user: SessionUser }>(
      '/auth/register',
      input,
    );
    setAccessToken(response.tokens.accessToken);
    applySession(set, response.user);
  },

  logout: async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    localStorage.removeItem(ACTIVE_ORG_KEY);
    set({ user: null, activeOrganizationId: null, organizations: [], organizationsLoaded: false });
  },

  reload: async () => {
    const user = await api.get<SessionUser>('/me');
    applySession(set, user);
    await get().loadOrganizations();
  },

  setActiveOrganization: (organizationId) => {
    localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
    set({ activeOrganizationId: organizationId });
  },

  loadOrganizations: async () => {
    const { user } = get();
    if (!user) return;

    // Solo hace falta para el administrador de la instalación: el resto ya
    // tiene sus organizaciones dentro de la sesión.
    if (user.platformRole !== 'superadmin') {
      set({ organizationsLoaded: true });
      return;
    }

    try {
      const list = await api.get<ManageableOrganization[]>('/organizations');
      const stored = localStorage.getItem(ACTIVE_ORG_KEY);
      const active =
        (stored && list.some((organization) => organization.id === stored) ? stored : null) ??
        get().activeOrganizationId ??
        list[0]?.id ??
        null;

      set({ organizations: list, organizationsLoaded: true, activeOrganizationId: active });
    } catch {
      set({ organizationsLoaded: true });
    }
  },

  membership: () => {
    const { user, activeOrganizationId } = get();
    if (!user || !activeOrganizationId) return null;
    return (
      user.memberships.find(
        (membership) => membership.organizationId === activeOrganizationId,
      ) ?? null
    );
  },

  can: (permission) => {
    const { user } = get();
    if (!user) return false;
    // El superadministrador de la instalación puede todo, aunque no tenga
    // pertenencia explícita a la organización.
    if (user.platformRole === 'superadmin') return true;
    return get().membership()?.permissions.includes(permission) ?? false;
  },

  isStaff: () => {
    const { user } = get();
    if (!user) return false;
    return user.platformRole === 'superadmin' || user.memberships.length > 0;
  },
}));
