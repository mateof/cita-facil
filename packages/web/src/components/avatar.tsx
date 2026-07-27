import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import clsx from 'clsx';
import { initialsOf, resolveAvatar, type Avatar } from '@cita-facil/shared';

/**
 * Cómo se ve una entidad en una lista: su imagen, un icono o sus iniciales.
 *
 * El orden lo decide `resolveAvatar`, que está en el paquete compartido para
 * que el servidor y el navegador respondan lo mismo.
 *
 * Los iconos se cargan aparte y solo cuando hacen falta. La librería tiene
 * ~1750 y meterlos todos en la descarga inicial penalizaría a quien solo entra
 * a pedir cita; mientras llegan, se enseñan las iniciales, que es lo que se
 * vería igualmente si el icono no existiera.
 */

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

let libreria: Promise<Record<string, unknown>> | null = null;

/** Carga la librería de iconos una sola vez y la comparte. */
function cargarIconos(): Promise<Record<string, unknown>> {
  libreria ??= import('lucide-react') as unknown as Promise<Record<string, unknown>>;
  return libreria;
}

/**
 * Los iconos de la librería son objetos de `forwardRef`, no funciones, así que
 * mirar solo `typeof === 'function'` los descartaría todos.
 */
export function isIconComponent(valor: unknown): boolean {
  return typeof valor === 'function' || (typeof valor === 'object' && valor !== null);
}

/** `alarm-clock` en la base de datos, `AlarmClock` en la librería. */
export function iconComponentName(icon: string): string {
  return icon
    .split('-')
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join('');
}

export function useIconComponent(icon: string | null | undefined): IconComponent | null {
  const [componente, setComponente] = useState<IconComponent | null>(null);

  useEffect(() => {
    if (!icon) {
      setComponente(null);
      return;
    }

    let vigente = true;
    void cargarIconos().then((iconos) => {
      if (!vigente) return;
      const encontrado = iconos[iconComponentName(icon)];
      setComponente(isIconComponent(encontrado) ? (encontrado as IconComponent) : null);
    });
    return () => {
      vigente = false;
    };
  }, [icon]);

  return componente;
}

const TAMANOS = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-lg',
  xl: 'size-24 text-2xl',
} as const;

export function EntityAvatar({
  name,
  avatar,
  size = 'md',
  square,
  className,
}: {
  name: string;
  avatar?: Avatar | null;
  size?: keyof typeof TAMANOS;
  /** Cuadrado con esquinas redondeadas, para logotipos que no son personas. */
  square?: boolean;
  className?: string;
}) {
  const resuelto = resolveAvatar(name, avatar);
  const Icono = useIconComponent(resuelto.kind === 'icon' ? resuelto.icon : null);

  const base = clsx(
    'flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white',
    square ? 'rounded-xl' : 'rounded-full',
    TAMANOS[size],
    className,
  );

  if (resuelto.kind === 'image') {
    return (
      <img
        src={resuelto.url}
        alt=""
        // Decorativa: el nombre va siempre al lado en texto, y repetirlo aquí
        // haría que un lector de pantalla lo dijera dos veces.
        aria-hidden
        className={clsx(base, 'bg-slate-100 object-cover')}
      />
    );
  }

  const color = resuelto.color;

  if (resuelto.kind === 'icon' && Icono) {
    return (
      <span className={base} style={{ backgroundColor: color }} aria-hidden>
        <Icono className="size-1/2" />
      </span>
    );
  }

  // Iniciales: también es lo que se ve mientras carga un icono.
  return (
    <span className={base} style={{ backgroundColor: color }} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}
