import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Upload, X } from 'lucide-react';
import { AVATAR_COLORS, fuzzySearch, type Avatar } from '@cita-facil/shared';
import { api } from '../lib/api.ts';
import { EntityAvatar, iconComponentName, isIconComponent } from './avatar.tsx';
import { Button, ErrorMessage, Input, Tabs } from './ui.tsx';

/**
 * Elegir cómo se ve una entidad: subir una imagen, escoger un icono o dejar las
 * iniciales del nombre sobre un color.
 *
 * Las tres opciones conviven en la misma entidad y la que manda es la de más
 * arriba: quitando la imagen vuelve a verse el icono, y quitando el icono, las
 * iniciales. Por eso las pestañas no son excluyentes ni borran lo de al lado.
 */

/** Destinos admitidos por el API, que decide el permiso que hace falta. */
export type UploadTarget =
  | 'organization'
  | 'location'
  | 'service'
  | 'resource'
  | 'category'
  | 'credit_pack';

export function AvatarPicker({
  name,
  value,
  onChange,
  organizationId,
  target,
}: {
  /** Para las iniciales y la vista previa. */
  name: string;
  value: Avatar;
  onChange: (avatar: Avatar) => void;
  organizationId: string | null;
  target: UploadTarget;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('image');

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-3 flex items-center gap-3">
        <EntityAvatar name={name || '?'} avatar={value} size="lg" square />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">{t('avatar.preview')}</p>
          <p className="text-xs text-slate-500">{t('avatar.precedence')}</p>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'image', label: t('avatar.image') },
          { id: 'icon', label: t('avatar.icon') },
          { id: 'initials', label: t('avatar.initials') },
        ]}
      />

      {tab === 'image' && (
        <ImageTab
          value={value}
          onChange={onChange}
          organizationId={organizationId}
          target={target}
        />
      )}
      {tab === 'icon' && <IconTab value={value} onChange={onChange} />}
      {tab === 'initials' && <ColorTab name={name} value={value} onChange={onChange} />}
    </div>
  );
}

function ImageTab({
  value,
  onChange,
  organizationId,
  target,
}: {
  value: Avatar;
  onChange: (avatar: Avatar) => void;
  organizationId: string | null;
  target: UploadTarget;
}) {
  const { t } = useTranslation();
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const subir = async (file: File) => {
    setError(null);
    setSubiendo(true);
    try {
      const cuerpo = new FormData();
      cuerpo.append('target', target);
      cuerpo.append('file', file);
      const respuesta = await api.upload<{ url: string }>(
        `/organizations/${organizationId}/uploads`,
        cuerpo,
      );
      onChange({ ...value, imageUrl: respuesta.url });
    } catch (fallo) {
      setError(fallo);
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className="pt-3">
      <ErrorMessage error={error} />

      <input
        ref={entrada}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void subir(file);
          // Se limpia para poder volver a elegir el mismo fichero.
          event.target.value = '';
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          icon={subiendo ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          disabled={subiendo || !organizationId}
          onClick={() => entrada.current?.click()}
        >
          {value.imageUrl ? t('avatar.replaceImage') : t('avatar.uploadImage')}
        </Button>

        {value.imageUrl && (
          <Button
            variant="ghost"
            icon={<X className="size-4" />}
            onClick={() => onChange({ ...value, imageUrl: null })}
          >
            {t('avatar.removeImage')}
          </Button>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">{t('avatar.imageHint')}</p>
    </div>
  );
}

/**
 * Buscador sobre la librería entera.
 *
 * Los nombres son los de la librería y están en inglés, así que además del
 * nombre se busca por unas cuantas palabras en castellano de los casos más
 * habituales en un negocio de citas.
 */
const SINONIMOS: Record<string, string[]> = {
  scissors: ['tijeras', 'peluqueria', 'corte'],
  dumbbell: ['gimnasio', 'pesas', 'musculacion'],
  'heart-pulse': ['salud', 'clinica', 'medico'],
  stethoscope: ['medico', 'consulta', 'salud'],
  sparkles: ['belleza', 'estetica', 'limpieza'],
  sun: ['bronceado', 'solarium', 'sol'],
  bath: ['spa', 'bano', 'balneario'],
  car: ['taller', 'coche', 'vehiculo'],
  camera: ['fotografia', 'estudio', 'foto'],
  scale: ['abogado', 'juridico', 'balanza'],
  wrench: ['taller', 'reparacion', 'herramienta'],
  'graduation-cap': ['academia', 'clases', 'formacion'],
  utensils: ['restaurante', 'comida', 'mesa'],
  dog: ['veterinario', 'mascota', 'perro'],
  'paw-print': ['veterinario', 'mascota', 'huella'],
  smile: ['dentista', 'sonrisa', 'dental'],
  eye: ['optica', 'vista', 'ojo'],
  hand: ['manicura', 'mano', 'unas'],
  brush: ['maquillaje', 'pintura', 'brocha'],
  calendar: ['agenda', 'cita', 'calendario'],
  ticket: ['bono', 'entrada', 'ticket'],
  building: ['sede', 'local', 'edificio'],
  home: ['casa', 'sede', 'domicilio'],
  users: ['equipo', 'grupo', 'personas'],
  user: ['persona', 'cliente', 'perfil'],
};

interface OpcionDeIcono {
  id: string;
  terminos: string;
}

function IconTab({ value, onChange }: { value: Avatar; onChange: (avatar: Avatar) => void }) {
  const { t } = useTranslation();
  const [busqueda, setBusqueda] = useState('');
  const [nombres, setNombres] = useState<OpcionDeIcono[] | null>(null);

  // La librería entera pesa, así que se pide al abrir esta pestaña y no antes.
  useEffect(() => {
    let vigente = true;
    void import('lucide-react').then((modulo) => {
      if (!vigente) return;
      // Cada icono se exporta tres veces: `Dumbbell`, `DumbbellIcon` y
      // `LucideDumbbell`. Sin quitar los alias, la rejilla enseñaría el mismo
      // dibujo repetido y la búsqueda devolvería tres resultados iguales.
      const lista = Object.keys(modulo)
        .filter(
          (clave) =>
            /^[A-Z]/.test(clave) &&
            !clave.endsWith('Icon') &&
            !clave.startsWith('Lucide') &&
            isIconComponent((modulo as never)[clave]),
        )
        .map((clave) => kebab(clave))
        .filter((nombre, indice, todos) => todos.indexOf(nombre) === indice)
        .map((nombre) => ({ id: nombre, terminos: [nombre, ...(SINONIMOS[nombre] ?? [])].join(' ') }));
      setNombres(lista);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const visibles = useMemo(() => {
    if (!nombres) return [];
    return fuzzySearch(nombres, busqueda, { fields: (opcion) => [opcion.terminos], limit: 120 });
  }, [nombres, busqueda]);

  return (
    <div className="pt-3">
      <Input
        type="search"
        value={busqueda}
        placeholder={t('avatar.searchIcon')}
        aria-label={t('avatar.searchIcon')}
        onChange={(event) => setBusqueda(event.target.value)}
      />

      {value.icon && (
        <div className="mt-2">
          <Button variant="ghost" icon={<X className="size-4" />} onClick={() => onChange({ ...value, icon: null })}>
            {t('avatar.removeIcon')}
          </Button>
        </div>
      )}

      {!nombres && <p className="mt-3 text-sm text-slate-500">{t('common.loading')}</p>}

      {nombres && (
        <ul className="mt-3 grid max-h-56 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8">
          {visibles.map((opcion) => (
            <li key={opcion.id}>
              <button
                type="button"
                aria-label={opcion.id}
                aria-pressed={value.icon === opcion.id}
                className={
                  value.icon === opcion.id
                    ? 'flex aspect-square w-full items-center justify-center rounded-lg border-2 border-brand bg-brand-soft'
                    : 'flex aspect-square w-full items-center justify-center rounded-lg border border-slate-200 hover:border-brand'
                }
                onClick={() => onChange({ ...value, icon: opcion.id })}
              >
                <IconPreview name={opcion.id} />
              </button>
            </li>
          ))}
          {visibles.length === 0 && (
            <li className="col-span-full py-2 text-sm text-slate-500">{t('common.noMatches')}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Un icono suelto de la rejilla. La librería ya está cargada en esta pestaña. */
function IconPreview({ name }: { name: string }) {
  const [Icono, setIcono] = useState<React.ComponentType<{ className?: string }> | null>(null);

  useEffect(() => {
    let vigente = true;
    void import('lucide-react').then((modulo) => {
      if (!vigente) return;
      const encontrado = (modulo as unknown as Record<string, unknown>)[iconComponentName(name)];
      if (isIconComponent(encontrado)) {
        setIcono(() => encontrado as React.ComponentType<{ className?: string }>);
      }
    });
    return () => {
      vigente = false;
    };
  }, [name]);

  return Icono ? <Icono className="size-5 text-slate-700" /> : <span className="size-5" />;
}

function ColorTab({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Avatar;
  onChange: (avatar: Avatar) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="pt-3">
      <p className="text-xs text-slate-500">{t('avatar.initialsHint', { initials: name || '?' })}</p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {AVATAR_COLORS.map((color) => (
          <li key={color}>
            <button
              type="button"
              aria-label={color}
              aria-pressed={value.color === color}
              style={{ backgroundColor: color }}
              className={
                value.color === color
                  ? 'size-8 rounded-full ring-2 ring-slate-900 ring-offset-2'
                  : 'size-8 rounded-full'
              }
              onClick={() => onChange({ ...value, color })}
            />
          </li>
        ))}
      </ul>

      {value.color && (
        <div className="mt-2">
          <Button variant="ghost" icon={<X className="size-4" />} onClick={() => onChange({ ...value, color: null })}>
            {t('avatar.automaticColor')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** `AlarmClock` en la librería, `alarm-clock` en la base de datos. */
function kebab(nombre: string): string {
  return nombre
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
