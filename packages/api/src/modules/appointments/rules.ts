import type { CreditChargeMode } from '@cita-facil/shared';

/**
 * Reglas de reserva que un servicio puede heredar de su organización.
 *
 * La herencia se representa con `null` en el servicio, que no es lo mismo que
 * cero: cero quiere decir "sin límite" y es una decisión explícita del negocio.
 * Sin esta distinción no habría forma de que un servicio dijera "yo no pido
 * antelación" cuando la organización sí la pide.
 */

/**
 * Valor con el que un servicio dice "lo que diga la organización".
 *
 * Se usa un centinela y no NULL porque las columnas nacieron NOT NULL y SQLite
 * no permite cambiar eso sin recrear la tabla entera, con sus claves ajenas.
 * Hacia fuera (API, panel) la herencia se expresa como `null`; la traducción
 * ocurre en los bordes, y dentro de la base de datos solo vive este número.
 */
export const INHERIT = -1;

/** ¿Este valor guardado significa heredar? */
export function isInherited(value: number | null | undefined): boolean {
  return value === null || value === undefined || value === INHERIT;
}

/** De lo guardado a lo que se enseña: `-1` se cuenta como "sin configurar". */
export function toNullable(value: number | null | undefined): number | null {
  return isInherited(value) ? null : (value as number);
}

/** De lo que llega del panel a lo que se guarda. */
export function toStored(value: number | null | undefined): number {
  return value === null || value === undefined ? INHERIT : value;
}

export interface ServiceRuleColumns {
  min_advance_minutes: number | null;
  cancellation_cutoff_minutes: number | null;
  credit_charge_mode?: string | null;
}

export interface OrganizationRuleSettings {
  minAdvanceMinutes?: number;
  cancellationCutoffMinutes?: number;
  creditChargeMode?: CreditChargeMode;
}

export interface EffectiveRules {
  /** Minutos que tienen que faltar para poder reservar. 0 = sin límite. */
  minAdvanceMinutes: number;
  /** Minutos que tienen que faltar para poder cancelar. 0 = sin límite. */
  cancellationCutoffMinutes: number;
  creditChargeMode: CreditChargeMode;
}

export function effectiveRules(
  service: ServiceRuleColumns,
  settings: OrganizationRuleSettings | null | undefined,
): EffectiveRules {
  const modo = service.credit_charge_mode;

  return {
    minAdvanceMinutes: isInherited(service.min_advance_minutes)
      ? (settings?.minAdvanceMinutes ?? 0)
      : (service.min_advance_minutes as number),
    cancellationCutoffMinutes: isInherited(service.cancellation_cutoff_minutes)
      ? (settings?.cancellationCutoffMinutes ?? 0)
      : (service.cancellation_cutoff_minutes as number),
    creditChargeMode:
      modo === 'booking' || modo === 'completion'
        ? modo
        : (settings?.creditChargeMode ?? 'booking'),
  };
}

/**
 * Opciones que ofrece el panel, en minutos.
 *
 * Están aquí y no en el frontend porque también las usa la documentación del
 * API; el nombre visible lo pone cada idioma.
 */
export const CUTOFF_PRESETS = [0, 60, 120, 360, 600, 720, 1440, 2880, 10_080] as const;
