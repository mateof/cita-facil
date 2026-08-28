import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FONT_STACKS, headerLabels } from '@cita-facil/shared';
import { api } from '../lib/api.ts';
import type { PublicOrganization } from '../lib/types.ts';
import { EntityAvatar } from './avatar.tsx';
import { useOrganizationSlug } from '../stores/organization-context.ts';

/**
 * Lo que se lee arriba a la izquierda.
 *
 * En el portal de un negocio es su marca; en la portada común, en el acceso y
 * en el resto de la aplicación, el nombre de la aplicación. El nombre largo se
 * enseña en escritorio y el corto en móvil, porque una peluquería con nombre
 * largo no cabe en 360 píxeles junto al resto de la barra.
 *
 * La organización se deduce del primer tramo de la dirección en vez de pasarse
 * por props: el layout envuelve a las rutas y no recibe sus parámetros. La
 * consulta comparte clave con la de la página de reservas, así que no añade
 * ninguna petición.
 */
export function HeaderBrand() {
  const { t } = useTranslation();
  const location = useLocation();

  // La misma regla que usa el layout para el tema: la dirección manda y, en
  // las pantallas comunes, vale la última organización por la que se entró.
  const slug = useOrganizationSlug(location.pathname);

  const organizacion = useQuery({
    enabled: Boolean(slug),
    queryKey: ['public-org', slug],
    queryFn: () => api.get<PublicOrganization>(`/public/organizations/${slug}`),
  });

  const datos = organizacion.data;
  if (!slug || !datos) {
    return (
      <NavLink to="/" className="text-lg font-bold text-brand">
        {t('common.appName')}
      </NavLink>
    );
  }

  const header = datos.theme?.header ?? null;
  const { long, short } = headerLabels(header, datos.organization.name);

  const estilo = {
    color: header?.color ?? undefined,
    fontSize: header?.fontSize ?? undefined,
    fontWeight: header?.weight ?? undefined,
    fontFamily: header?.fontFamily ? FONT_STACKS[header.fontFamily] : undefined,
  };

  return (
    <NavLink
      to={`/${slug}`}
      className="flex items-center gap-2 text-lg font-bold text-brand"
      style={estilo}
    >
      {header?.useImage && (
        <EntityAvatar
          name={datos.organization.name}
          avatar={{
            imageUrl: datos.organization.imageUrl,
            icon: datos.organization.icon,
            color: datos.organization.color,
          }}
          size="sm"
          square
        />
      )}
      {/* Los dos van en el marcado y se enseña uno u otro por ancho: así no
          depende de JavaScript ni parpadea al cargar. */}
      <span className="hidden sm:inline">{long}</span>
      <span className="sm:hidden">{short}</span>
    </NavLink>
  );
}
