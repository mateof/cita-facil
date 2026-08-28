import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { OrganizationSummary } from '../lib/types.ts';
import { useAuth } from '../stores/auth.ts';
import { useOrganizationSlug } from '../stores/organization-context.ts';
import { Combobox } from './combobox.tsx';
import { Modal } from './ui.tsx';

/**
 * Cambiar de establecimiento desde el portal de cliente.
 *
 * "Reservar" lleva al negocio en curso, no a la portada, porque pasar por la
 * portada perdía el establecimiento. Eso deja sin salida a quien reserva en más
 * de uno, y esta es la salida: no una pantalla nueva, solo una forma de llegar
 * al negocio que se quiere.
 *
 * No se pinta casi nunca. Hace falta sesión iniciada, porque el directorio no
 * se sirve a quien no la tiene, y más de un negocio activo: en la instalación
 * normal, de uno solo, no hay nada entre lo que elegir.
 *
 * Es un `Combobox` y no un desplegable porque la lista crece con la
 * instalación, y así se filtra con la misma búsqueda aproximada que el resto de
 * la aplicación.
 */
export function OrganizationSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuth((state) => state.user);
  const slug = useOrganizationSlug(location.pathname);
  const [abierto, setAbierto] = useState(false);

  // Comparte clave con la portada y con Mis bonos, así que no añade petición
  // en cuanto una de las tres la ha hecho.
  const { data } = useQuery({
    enabled: Boolean(user),
    queryKey: ['public-organizations'],
    queryFn: () => api.get<OrganizationSummary[]>('/public/organizations'),
  });

  const negocios = data ?? [];
  if (negocios.length < 2) return null;

  const actual = negocios.find((negocio) => negocio.slug === slug) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        aria-label={t('directory.switch')}
        title={t('directory.switch')}
      >
        <Building2 className="size-5" aria-hidden />
      </button>

      <Modal open={abierto} onClose={() => setAbierto(false)} title={t('directory.switch')}>
        <Combobox
          value={actual?.id ?? null}
          onChange={(id) => {
            const elegido = negocios.find((negocio) => negocio.id === id);
            if (!elegido) return;
            setAbierto(false);
            // A su página de reservas: es la dirección que vuelve a fijar el
            // negocio en curso y con él la marca y el tema.
            navigate(`/${elegido.slug}`);
          }}
          options={negocios.map((negocio) => ({ id: negocio.id, label: negocio.name }))}
          placeholder={t('directory.switchPlaceholder')}
          emptyText={t('directory.empty')}
          aria-label={t('directory.business')}
        />
      </Modal>
    </>
  );
}
