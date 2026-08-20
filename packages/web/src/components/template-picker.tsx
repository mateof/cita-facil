import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ORGANIZATION_TEMPLATES, templateText } from '@cita-facil/shared';
import { EntityAvatar } from './avatar.tsx';

/**
 * Plantilla de alta por tipo de negocio.
 *
 * Se elige al crear la organización y deja servicios, recursos y horario
 * puestos. La primera hora de uso es donde se pierde a la gente: una
 * organización vacía obliga a inventarse tres cosas antes de poder probar nada.
 *
 * Se puede no elegir ninguna, y esa opción va la primera y sin adornos: quien
 * ya sabe lo que quiere no tiene que esquivar cuatro tarjetas.
 */
export function TemplatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (template: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);

  const tarjeta = (
    key: string | null,
    titulo: string,
    descripcion: string,
    icono: string | null,
  ) => (
    <button
      key={key ?? 'none'}
      type="button"
      onClick={() => onChange(key)}
      aria-pressed={value === key}
      className={clsx(
        'flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition',
        value === key
          ? 'border-brand bg-brand-soft/40 shadow-sm'
          : 'border-slate-200 hover:border-brand',
      )}
    >
      <EntityAvatar name={titulo} avatar={{ icon: icono }} square />
      <span className="min-w-0">
        <span className="block font-semibold text-slate-900">{titulo}</span>
        <span className="block text-sm text-slate-500">{descripcion}</span>
      </span>
    </button>
  );

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {tarjeta(null, t('admin.templates.none'), t('admin.templates.noneHint'), 'circle-dashed')}
      {ORGANIZATION_TEMPLATES.map((template) =>
        tarjeta(
          template.key,
          templateText(template.label, locale),
          templateText(template.description, locale),
          template.icon,
        ),
      )}
    </div>
  );
}
