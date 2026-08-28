import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { SERVICE_START_MODES, WEEKDAYS, type ServiceStartTimes } from '@cita-facil/shared';
import { Field, Input, Select } from './ui.tsx';

/**
 * A qué horas puede empezar una cita de este servicio.
 *
 * En el mismo negocio conviven la consulta que se da a cualquier hora libre, el
 * tratamiento que solo empieza en punto y la clase que es martes y jueves a las
 * 12:00. Con una sola rejilla para toda la organización hay que elegir la más
 * fina y confiar en que nadie reserve a deshora.
 *
 * El modo es una lista corta y cerrada, así que va en un desplegable y no en un
 * `Combobox`: no enlaza con ninguna entidad.
 */

/** `540` → `09:00`. Las horas locales viajan en minutos desde medianoche. */
export function minutesToTime(minutes: number): string {
  const hora = Math.floor(minutes / 60);
  const minuto = minutes % 60;
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

/**
 * Lee una lista de horas escrita a mano: `12:00, 16:30`.
 *
 * Se escriben seguidas y no con un selector por hora porque quien configura
 * esto lo tiene en la cabeza como una lista ("los martes a las 12 y a las 4") y
 * teclearla es más rápido que añadir campos de uno en uno. Lo que no se
 * entiende se descarta en vez de bloquear el campo mientras se escribe.
 */
export function parseTimes(text: string): number[] {
  const horas = new Set<number>();
  for (const trozo of text.split(/[,;\s]+/)) {
    const match = /^(\d{1,2})[:.h]?(\d{2})?$/.exec(trozo.trim());
    if (!match) continue;
    const hora = Number(match[1]);
    const minuto = Number(match[2] ?? '0');
    if (hora > 23 || minuto > 59) continue;
    horas.add(hora * 60 + minuto);
  }
  return [...horas].sort((a, b) => a - b);
}

export interface StartTimesValue {
  startMode: (typeof SERVICE_START_MODES)[number];
  startIntervalMinutes: number | null;
  startOffsetMinutes: number;
  startTimes: ServiceStartTimes[];
}

export function ServiceStartTimesEditor({
  value,
  onChange,
}: {
  value: StartTimesValue;
  onChange: (patch: Partial<StartTimesValue>) => void;
}) {
  const { t } = useTranslation();

  const grupos = value.startTimes ?? [];
  const setGrupos = (next: ServiceStartTimes[]) => onChange({ startTimes: next });

  return (
    <fieldset className="mb-4 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold">{t('admin.services.startMode')}</legend>

      <Field label={t('admin.services.startMode')} hint={t(`admin.services.startModeHint.${value.startMode}`)}>
        <Select
          value={value.startMode}
          onChange={(event) =>
            onChange({ startMode: event.target.value as StartTimesValue['startMode'] })
          }
        >
          {SERVICE_START_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`admin.services.startModes.${mode}`)}
            </option>
          ))}
        </Select>
      </Field>

      {value.startMode === 'interval' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.services.startInterval')} className="mb-0">
            <Select
              value={String(value.startIntervalMinutes ?? 30)}
              onChange={(event) => onChange({ startIntervalMinutes: Number(event.target.value) })}
            >
              {[5, 10, 15, 20, 30, 45, 60, 90, 120].map((minutos) => (
                <option key={minutos} value={minutos}>
                  {t('admin.services.everyMinutes', { count: minutos })}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t('admin.services.startOffset')}
            hint={t('admin.services.startOffsetHint')}
            className="mb-0"
          >
            <Input
              type="number"
              min={0}
              max={(value.startIntervalMinutes ?? 30) - 1}
              value={value.startOffsetMinutes ?? 0}
              onChange={(event) => onChange({ startOffsetMinutes: Number(event.target.value) })}
            />
          </Field>
        </div>
      )}

      {value.startMode === 'fixed' && (
        <div className="space-y-3">
          {grupos.length === 0 && (
            <p className="text-sm text-slate-500">{t('admin.services.startTimesEmpty')}</p>
          )}

          {grupos.map((grupo, indice) => (
            <div key={indice} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  {t('admin.services.startTimesDays')}
                </span>
                <button
                  type="button"
                  onClick={() => setGrupos(grupos.filter((_, i) => i !== indice))}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>

              {/* Ninguno marcado = todos los días, que es lo que dice el aviso
                  de abajo. Así una hora diaria no obliga a marcar los siete. */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((weekday) => {
                  const activo = grupo.weekdays.includes(weekday);
                  return (
                    <button
                      key={weekday}
                      type="button"
                      aria-pressed={activo}
                      onClick={() =>
                        setGrupos(
                          grupos.map((otro, i) =>
                            i === indice
                              ? {
                                  ...otro,
                                  weekdays: activo
                                    ? otro.weekdays.filter((d) => d !== weekday)
                                    : [...otro.weekdays, weekday].sort((a, b) => a - b),
                                }
                              : otro,
                          ),
                        )
                      }
                      className={
                        activo
                          ? 'rounded-lg border border-brand bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand'
                          : 'rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-slate-300'
                      }
                    >
                      {t(`admin.services.weekdaysShort.${weekday}`)}
                    </button>
                  );
                })}
              </div>

              {grupo.weekdays.length === 0 && (
                <p className="mb-2 text-xs text-slate-500">{t('admin.services.startTimesAllDays')}</p>
              )}

              <Field
                label={t('admin.services.startTimesHours')}
                hint={t('admin.services.startTimesHoursHint')}
                className="mb-0"
              >
                <Input
                  defaultValue={grupo.minutes.map(minutesToTime).join(', ')}
                  placeholder="12:00, 16:00"
                  onBlur={(event) =>
                    setGrupos(
                      grupos.map((otro, i) =>
                        i === indice ? { ...otro, minutes: parseTimes(event.target.value) } : otro,
                      ),
                    )
                  }
                />
              </Field>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setGrupos([...grupos, { weekdays: [], minutes: [] }])}
            className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
          >
            <Plus className="size-4" aria-hidden />
            {t('admin.services.startTimesAdd')}
          </button>
        </div>
      )}
    </fieldset>
  );
}
