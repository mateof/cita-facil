import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, X } from 'lucide-react';
import { fuzzySearch } from '@cita-facil/shared';
import { Spinner } from './ui.tsx';

/**
 * Campo para enlazar con otra entidad: se escribe y va sugiriendo.
 *
 * Sustituye al desplegable donde la lista puede crecer (personas, servicios,
 * recursos, sedes, tipos de bono). Con listas de tres opciones fijas, como un
 * rol o un estado, sigue siendo mejor un `<select>`.
 *
 * Dos modos según de dónde salgan las opciones:
 *
 * - **Local**: se le pasan todas las opciones y el componente las filtra con la
 *   misma búsqueda aproximada que usa el backend, así que tolera acentos y
 *   erratas igual que el resto de la aplicación.
 * - **Remoto**: con `onQueryChange` el filtrado lo hace quien busca (una
 *   consulta al API) y aquí solo se pinta lo que llegue. El texto se manda con
 *   un respiro de 200 ms para no lanzar una petición por tecla.
 *
 * Sobre accesibilidad: sigue el patrón `combobox` de ARIA. El elemento activo
 * se anuncia con `aria-activedescendant` en vez de moverle el foco, que es lo
 * que permite seguir escribiendo mientras se recorre la lista con las flechas.
 */

export interface ComboboxOption {
  id: string;
  label: string;
  /** Segunda línea: el correo de la persona, el precio del servicio... */
  description?: string | null;
  disabled?: boolean;
}

export interface ComboboxProps {
  value: string | null;
  onChange: (id: string | null, option: ComboboxOption | null) => void;
  options: ComboboxOption[];
  /** Presente = el filtrado es remoto y aquí no se vuelve a filtrar. */
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  /** Texto cuando no hay nada que sugerir. */
  emptyText?: string;
  disabled?: boolean;
  /** Los inyecta `Field`; hay que trasladarlos al `input` de verdad. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  onQueryChange,
  loading = false,
  placeholder,
  emptyText,
  disabled = false,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-opciones`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activo, setActivo] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);

  const elegida = options.find((option) => option.id === value) ?? null;

  const visibles = useMemo(() => {
    if (onQueryChange) return options;
    return fuzzySearch(options, query, {
      fields: (option) => [option.label, option.description],
      limit: 50,
    });
  }, [options, query, onQueryChange]);

  // El texto viaja al buscador remoto con un respiro, para no encadenar una
  // petición por cada tecla.
  useEffect(() => {
    if (!onQueryChange) return;
    const espera = setTimeout(() => onQueryChange(query), 200);
    return () => clearTimeout(espera);
  }, [query, onQueryChange]);

  // Un clic fuera cierra la lista. Sin esto se quedaría abierta al pasar a otro
  // campo del formulario.
  useEffect(() => {
    if (!open) return;
    const alPulsar = (event: MouseEvent) => {
      if (!contenedor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', alPulsar);
    return () => document.removeEventListener('mousedown', alPulsar);
  }, [open]);

  useEffect(() => {
    setActivo(0);
  }, [query, options]);

  const abrir = () => {
    if (disabled) return;
    setOpen(true);
  };

  const elegir = (option: ComboboxOption) => {
    if (option.disabled) return;
    onChange(option.id, option);
    setQuery('');
    setOpen(false);
  };

  const limpiar = () => {
    onChange(null, null);
    setQuery('');
    onQueryChange?.('');
  };

  const alTeclear = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const salto = event.key === 'ArrowDown' ? 1 : -1;
      setActivo((actual) => {
        if (visibles.length === 0) return 0;
        return (actual + salto + visibles.length) % visibles.length;
      });
      return;
    }

    if (event.key === 'Enter' && open) {
      const option = visibles[activo];
      if (option) {
        event.preventDefault();
        elegir(option);
      }
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  // Con algo elegido y sin escribir, el campo enseña lo elegido.
  const texto = open || !elegida ? query : elegida.label;

  return (
    <div className="relative" ref={contenedor}>
      <div className="relative">
        <input
          id={inputId}
          role="combobox"
          type="text"
          autoComplete="off"
          className="input pr-16"
          value={texto}
          disabled={disabled}
          placeholder={placeholder ?? t('common.searchOrChoose')}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visibles[activo] ? `${listId}-${activo}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-label={ariaLabel}
          onFocus={abrir}
          onClick={abrir}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={alTeclear}
        />

        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {loading && <Spinner />}
          {elegida && !disabled && (
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label={t('common.clear')}
              onClick={limpiar}
            >
              <X className="size-4" />
            </button>
          )}
          <ChevronDown className="size-4 text-slate-400" aria-hidden />
        </div>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {visibles.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">
              {loading ? t('common.loading') : (emptyText ?? t('common.noMatches'))}
            </li>
          )}

          {visibles.map((option, indice) => (
            <li key={option.id}>
              <button
                type="button"
                id={`${listId}-${indice}`}
                role="option"
                aria-selected={option.id === value}
                disabled={option.disabled}
                className={clsxOption(indice === activo, option.id === value, option.disabled)}
                // `onMouseDown` y no `onClick`: al pulsar, el campo pierde el
                // foco y con `onClick` la lista ya se habría cerrado.
                onMouseDown={(event) => {
                  event.preventDefault();
                  elegir(option);
                }}
                onMouseEnter={() => setActivo(indice)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.description && (
                    <span className="block truncate text-xs text-slate-500">
                      {option.description}
                    </span>
                  )}
                </span>
                {option.id === value && <Check className="size-4 shrink-0 text-brand" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function clsxOption(activo: boolean, elegida: boolean, deshabilitada = false): string {
  const base = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm';
  if (deshabilitada) return `${base} cursor-not-allowed text-slate-400`;
  if (activo) return `${base} bg-brand-soft text-brand`;
  return `${base} ${elegida ? 'font-medium' : ''} hover:bg-slate-50`;
}
