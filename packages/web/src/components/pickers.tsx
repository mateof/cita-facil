import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { useAuth } from '../stores/auth.ts';
import type { CreditCustomer } from '../lib/types.ts';
import { Combobox, type ComboboxOption } from './combobox.tsx';

/**
 * Buscadores de entidades concretas, montados sobre `Combobox`.
 *
 * Están aquí y no en cada pantalla porque el mismo buscador de personas se usa
 * al entregar un bono y al dar de alta una cita desde el mostrador, y las dos
 * tienen que comportarse igual.
 */

/**
 * Personas a las que el centro puede enlazar algo.
 *
 * Sugiere clientes de la organización según se escribe, tolerando acentos y
 * erratas. A quien todavía no es cliente solo lo encuentra por su correo
 * entero: la búsqueda por nombre no sale de la organización, para que desde un
 * negocio no se pueda ir listando la clientela de los demás.
 */
export function CustomerPicker({
  value,
  onChange,
  id,
  disabled,
  ...aria
}: {
  value: string | null;
  onChange: (id: string | null, option: ComboboxOption | null) => void;
  id?: string;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const [query, setQuery] = useState('');
  const [elegida, setElegida] = useState<ComboboxOption | null>(null);

  const users = useQuery({
    enabled: Boolean(organizationId) && query.trim().length >= 2,
    queryKey: ['credit-customers', organizationId, query],
    queryFn: () =>
      api.get<CreditCustomer[]>(`/organizations/${organizationId}/credit-customers`, {
        query: { query },
      }),
  });

  const opciones: ComboboxOption[] = (users.data ?? []).map((user) => ({
    id: user.id,
    label: user.name,
    description: user.email,
  }));

  // Lo elegido se guarda aparte: al vaciar el buscador deja de venir en la
  // respuesta y el campo se quedaría sin nombre que enseñar.
  if (elegida && !opciones.some((option) => option.id === elegida.id)) {
    opciones.unshift(elegida);
  }

  return (
    <Combobox
      id={id}
      {...aria}
      disabled={disabled}
      value={value}
      options={opciones}
      loading={users.isFetching}
      onQueryChange={setQuery}
      emptyText={query.trim().length < 2 ? t('admin.credits.personHint') : undefined}
      onChange={(id, option) => {
        setElegida(option);
        onChange(id, option);
      }}
    />
  );
}

/** Convierte cualquier lista con nombre en opciones para el `Combobox`. */
export function toOptions<T extends { id: string }>(
  items: T[] | undefined,
  label: (item: T) => string,
  description?: (item: T) => string | null | undefined,
): ComboboxOption[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    label: label(item),
    description: description?.(item) ?? null,
  }));
}
