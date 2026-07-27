import { useTranslation } from 'react-i18next';
import { Select } from './ui.tsx';

/**
 * Plazo en minutos, elegido de una lista legible.
 *
 * Se pide "una hora antes, doce horas antes, un día antes", no un número de
 * minutos: nadie configura 1440 pensando en minutos. Los valores siguen siendo
 * minutos por debajo, que es lo que guarda el servidor.
 *
 * `null` es "lo que diga la organización" y `0` es "sin límite", y son cosas
 * distintas: un servicio puede querer no pedir antelación aunque su
 * organización sí la pida.
 */

const OPCIONES = [0, 60, 120, 360, 600, 720, 1440, 2880, 10_080] as const;

export function CutoffSelect({
  value,
  onChange,
  allowInherit,
  id,
  ...aria
}: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** Ofrece "lo que diga la organización". Solo en los servicios. */
  allowInherit?: boolean;
  id?: string;
  'aria-describedby'?: string;
}) {
  const { t } = useTranslation();

  const etiqueta = (minutos: number): string => {
    if (minutos === 0) return t('admin.rules.noLimit');
    if (minutos < 60) return t('admin.rules.minutes', { count: minutos });
    if (minutos < 1440) return t('admin.rules.hours', { count: minutos / 60 });
    if (minutos === 10_080) return t('admin.rules.week');
    return t('admin.rules.days', { count: minutos / 1440 });
  };

  return (
    <Select
      id={id}
      {...aria}
      value={value === null || value === undefined ? 'inherit' : String(value)}
      onChange={(event) =>
        onChange(event.target.value === 'inherit' ? null : Number(event.target.value))
      }
    >
      {allowInherit && <option value="inherit">{t('admin.rules.inherit')}</option>}
      {OPCIONES.map((minutos) => (
        <option key={minutos} value={minutos}>
          {etiqueta(minutos)}
        </option>
      ))}
    </Select>
  );
}
