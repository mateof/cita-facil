import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, Palette, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import {
  THEME_PRESETS,
  THEME_TOKENS,
  defaultThemeTokens,
  fuzzySearch,
  headerLabels,
  themeToCssVariables,
  type Theme,
  type ThemeFile,
  type ThemeHeader,
  type ThemeTokenDef,
} from '@cita-facil/shared';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { formatDate } from '../../lib/format.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from '../../components/ui.tsx';

/**
 * Temas de la organización.
 *
 * La tabla es lo que se mira a diario ("cuál está en uso, cuál era el de
 * Navidad"), así que enseña el nombre, una muestra de sus colores y cuándo se
 * tocó por última vez. Los ejemplos que trae la aplicación no aparecen en la
 * tabla: se copian desde el botón, y a partir de ahí son temas propios como
 * cualquier otro.
 */
export default function Themes() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();

  const [filtro, setFiltro] = useState('');
  const [editando, setEditando] = useState<Theme | null>(null);
  const [importando, setImportando] = useState(false);

  const temas = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['themes', organizationId],
    queryFn: () => api.get<Theme[]>(`/organizations/${organizationId}/themes`),
  });

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['themes'] });

  const activar = useMutation({
    mutationFn: (id: string) =>
      api.post(`/organizations/${organizationId}/themes/${id}/activate`),
    onSuccess: () => void refrescar(),
  });

  const desactivar = useMutation({
    mutationFn: () => api.post(`/organizations/${organizationId}/themes/deactivate`),
    onSuccess: () => void refrescar(),
  });

  const borrar = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/themes/${id}`),
    onSuccess: () => void refrescar(),
  });

  const duplicar = useMutation({
    mutationFn: async (tema: Theme) => {
      const fichero = await api.get<ThemeFile>(
        `/organizations/${organizationId}/themes/${tema.id}/export`,
      );
      return api.post(`/organizations/${organizationId}/themes/import`, {
        ...fichero,
        name: `${fichero.name} (copia)`,
      });
    },
    onSuccess: () => void refrescar(),
  });

  const copiarEjemplo = useMutation({
    mutationFn: (preset: string) =>
      api.post<Theme>(`/organizations/${organizationId}/themes/presets/${preset}`),
    onSuccess: (tema) => {
      void refrescar();
      setEditando(tema);
    },
  });

  const exportar = async (tema: Theme) => {
    const fichero = await api.get<ThemeFile>(
      `/organizations/${organizationId}/themes/${tema.id}/export`,
    );
    const blob = new Blob([JSON.stringify(fichero, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `tema-${tema.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    enlace.click();
    URL.revokeObjectURL(url);
  };

  const visibles = useMemo(
    () =>
      fuzzySearch(temas.data ?? [], filtro, {
        fields: (tema) => [tema.name, tema.description],
        limit: 200,
      }),
    [temas.data, filtro],
  );

  const enUso = temas.data?.find((tema) => tema.active) ?? null;

  return (
    <div>
      <PageHeader title={t('admin.themes.title')} description={t('admin.themes.description')} />

      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <Field label={t('common.search')} className="mb-0 w-60">
            <Input
              type="search"
              value={filtro}
              placeholder={t('admin.themes.columnName')}
              onChange={(event) => setFiltro(event.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <PresetMenu onPick={(preset) => copiarEjemplo.mutate(preset)} />
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => setImportando(true)}>
              {t('admin.themes.importAction')}
            </Button>
            <Button
              icon={<Plus className="size-4" />}
              onClick={() =>
                setEditando({
                  id: '',
                  organizationId: organizationId ?? '',
                  name: '',
                  description: null,
                  tokens: defaultThemeTokens(),
                  customCss: null,
                  header: null,
                  active: false,
                  createdAt: '',
                  updatedAt: null,
                })
              }
            >
              {t('admin.themes.newTheme')}
            </Button>
          </div>
        </div>

        <ErrorMessage error={activar.error ?? borrar.error ?? copiarEjemplo.error} />
        {temas.isLoading && <LoadingBlock rows={3} />}

        {temas.data?.length === 0 && <p className="py-4 text-sm text-slate-500">{t('admin.themes.empty')}</p>}
        {temas.data && temas.data.length > 0 && visibles.length === 0 && (
          <p className="py-4 text-sm text-slate-500">{t('admin.themes.noMatches')}</p>
        )}

        {visibles.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('admin.themes.columnName')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('admin.themes.columnColors')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('admin.themes.columnUpdated')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('admin.themes.columnActions')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {visibles.map((tema) => (
                  <tr key={tema.id}>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {tema.name}
                        {tema.active && (
                          <Badge className="bg-emerald-100 text-emerald-800">
                            {t('admin.themes.active')}
                          </Badge>
                        )}
                      </span>
                      {tema.description && (
                        <span className="block text-xs text-slate-500">{tema.description}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <ColorStrip tokens={tema.tokens} />
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">
                      {formatDate(tema.updatedAt ?? tema.createdAt, locale)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {!tema.active && (
                          <button
                            type="button"
                            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                            aria-label={t('admin.themes.activate')}
                            onClick={() => activar.mutate(tema.id)}
                          >
                            <Check className="size-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                          aria-label={t('common.edit')}
                          onClick={() => setEditando(tema)}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                          aria-label={t('admin.themes.duplicate')}
                          onClick={() => duplicar.mutate(tema)}
                        >
                          <Copy className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                          aria-label={t('admin.themes.exportAction')}
                          onClick={() => void exportar(tema)}
                        >
                          <Download className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={t('common.delete')}
                          onClick={() => borrar.mutate(tema.id)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {enUso && (
          <div className="mt-4">
            <Button variant="ghost" onClick={() => desactivar.mutate()}>
              {t('admin.themes.deactivate')}
            </Button>
          </div>
        )}
      </Card>

      <ThemeEditor theme={editando} onClose={() => setEditando(null)} />
      <ImportDialog open={importando} onClose={() => setImportando(false)} />
    </div>
  );
}

/** Muestra de los colores principales, para reconocer un tema de un vistazo. */
function ColorStrip({ tokens }: { tokens: Record<string, string> }) {
  const muestra = ['brand', 'background', 'surface', 'text', 'border'];
  return (
    <span className="flex gap-1">
      {muestra.map((clave) => (
        <span
          key={clave}
          className="size-5 rounded border border-slate-200"
          style={{ backgroundColor: tokens[clave] }}
          aria-hidden
        />
      ))}
    </span>
  );
}

function PresetMenu({ onPick }: { onPick: (preset: string) => void }) {
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="relative">
      <Button variant="secondary" icon={<Palette className="size-4" />} onClick={() => setAbierto(!abierto)}>
        {t('admin.themes.fromPreset')}
      </Button>

      {abierto && (
        <ul className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {THEME_PRESETS.map((preset) => (
            <li key={preset.key}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  setAbierto(false);
                  onPick(preset.key);
                }}
              >
                <ColorStrip tokens={preset.tokens} />
                {t(`admin.themes.presets.${preset.key}`, preset.name)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                      */
/* -------------------------------------------------------------------------- */

function ThemeEditor({ theme, onClose }: { theme: Theme | null; onClose: () => void }) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Theme | null>(null);
  const cargado = useRef('');

  // Se copia una sola vez por tema: si se copiara en cada render, cualquier
  // refresco de la lista borraría lo que se esté escribiendo.
  useEffect(() => {
    if (!theme) return;
    const clave = theme.id || 'nuevo';
    if (cargado.current === clave) return;
    cargado.current = clave;
    setDraft({ ...theme, tokens: { ...defaultThemeTokens(), ...theme.tokens } });
  }, [theme]);

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        name: draft!.name,
        description: draft!.description,
        tokens: draft!.tokens,
        customCss: draft!.customCss,
        header: draft!.header,
      };
      return draft!.id
        ? api.patch(`/organizations/${organizationId}/themes/${draft!.id}`, cuerpo)
        : api.post(`/organizations/${organizationId}/themes`, cuerpo);
    },
    onSuccess: () => {
      cargado.current = '';
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
    },
  });

  if (!draft) return null;

  const set = (patch: Partial<Theme>) => setDraft({ ...draft, ...patch });
  const setToken = (clave: string, valor: string) =>
    setDraft({ ...draft, tokens: { ...draft.tokens, [clave]: valor } });
  const setHeader = (patch: Partial<ThemeHeader>) =>
    setDraft({ ...draft, header: { ...draft.header, ...patch } });

  const grupos: ThemeTokenDef['group'][] = ['color', 'text', 'shape'];

  return (
    <Modal
      open={theme !== null}
      onClose={onClose}
      wide
      title={draft.id ? draft.name : t('admin.themes.newTheme')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={guardar.isPending} disabled={!draft.name} onClick={() => guardar.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ErrorMessage error={guardar.error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div>
          <Field label={t('admin.themes.name')} required>
            <Input value={draft.name} onChange={(event) => set({ name: event.target.value })} />
          </Field>

          <Field label={t('admin.themes.themeDescription')}>
            <Input
              value={draft.description ?? ''}
              onChange={(event) => set({ description: event.target.value })}
            />
          </Field>

          {grupos.map((grupo) => (
            <fieldset key={grupo} className="mb-4 rounded-xl border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold">
                {t(`admin.themes.groups.${grupo}`)}
              </legend>

              <div className="grid gap-3 sm:grid-cols-2">
                {THEME_TOKENS.filter((token) => token.group === grupo).map((token) => (
                  <Field key={token.key} label={t(`admin.themes.tokens.${token.key}`, token.key)} className="mb-0">
                    {token.kind === 'color' ? (
                      <Input
                        type="color"
                        value={draft.tokens[token.key] ?? token.default}
                        onChange={(event) => setToken(token.key, event.target.value)}
                      />
                    ) : token.kind === 'select' ? (
                      <Select
                        value={draft.tokens[token.key] ?? token.default}
                        onChange={(event) => setToken(token.key, event.target.value)}
                      >
                        {token.options?.map((opcion) => (
                          <option key={opcion} value={opcion}>
                            {t(`admin.themes.options.${opcion}`, opcion)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        value={draft.tokens[token.key] ?? token.default}
                        onChange={(event) => setToken(token.key, event.target.value)}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset className="mb-4 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 text-sm font-semibold">{t('admin.themes.header')}</legend>
            <p className="mb-3 text-xs text-slate-500">{t('admin.themes.headerHint')}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('admin.themes.longName')} className="mb-0">
                <Input
                  value={draft.header?.longName ?? ''}
                  onChange={(event) => setHeader({ longName: event.target.value })}
                />
              </Field>
              <Field label={t('admin.themes.shortName')} className="mb-0">
                <Input
                  value={draft.header?.shortName ?? ''}
                  onChange={(event) => setHeader({ shortName: event.target.value })}
                />
              </Field>
              <Field label={t('admin.themes.headerColor')} className="mb-0">
                <Input
                  type="color"
                  value={draft.header?.color ?? '#2563eb'}
                  onChange={(event) => setHeader({ color: event.target.value })}
                />
              </Field>
              <Field label={t('admin.themes.headerSize')} className="mb-0">
                <Input
                  value={draft.header?.fontSize ?? ''}
                  placeholder="1.125rem"
                  onChange={(event) => setHeader({ fontSize: event.target.value })}
                />
              </Field>
              <Field label={t('admin.themes.headerWeight')} className="mb-0">
                <Input
                  value={draft.header?.weight ?? ''}
                  placeholder="700"
                  onChange={(event) => setHeader({ weight: event.target.value })}
                />
              </Field>
              <Field label={t('admin.themes.headerFont')} className="mb-0">
                <Select
                  value={draft.header?.fontFamily ?? 'system'}
                  onChange={(event) =>
                    setHeader({ fontFamily: event.target.value as ThemeHeader['fontFamily'] })
                  }
                >
                  {['system', 'serif', 'mono', 'rounded'].map((opcion) => (
                    <option key={opcion} value={opcion}>
                      {t(`admin.themes.options.${opcion}`, opcion)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="mt-3">
              <Switch
                checked={draft.header?.useImage ?? false}
                onChange={(valor) => setHeader({ useImage: valor })}
                label={t('admin.themes.headerUseImage')}
              />
            </div>
          </fieldset>

          <Field label={t('admin.themes.customCss')} hint={t('admin.themes.customCssHint')}>
            <Textarea
              rows={8}
              className="font-mono text-xs"
              value={draft.customCss ?? ''}
              onChange={(event) => set({ customCss: event.target.value })}
            />
          </Field>
        </div>

        <ThemePreview theme={draft} />
      </div>
    </Modal>
  );
}

/**
 * Vista previa.
 *
 * Las variables se aplican en un contenedor y no en el documento, así que el
 * panel no cambia de aspecto mientras se edita: lo que se está retocando es la
 * página pública, no la pantalla en la que se está.
 */
function ThemePreview({ theme }: { theme: Theme }) {
  const { t } = useTranslation();
  const variables = themeToCssVariables(theme.tokens) as Record<string, string>;
  const { long, short } = headerLabels(theme.header, theme.name || t('admin.themes.preview'));

  return (
    <div className="lg:sticky lg:top-2 lg:self-start">
      <p className="mb-2 text-sm font-medium text-slate-700">{t('admin.themes.preview')}</p>

      <div
        className="overflow-hidden rounded-xl border"
        style={{
          ...variables,
          background: theme.tokens.background,
          borderColor: theme.tokens.border,
          fontFamily: variables['--tema-fuente'],
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{
            background: theme.tokens.headerBackground,
            color: theme.header?.color ?? theme.tokens.headerText,
            fontSize: theme.header?.fontSize ?? undefined,
            fontWeight: (theme.header?.weight as never) ?? 700,
          }}
        >
          <span className="hidden sm:inline">{long}</span>
          <span className="sm:hidden">{short}</span>
        </div>

        <div className="space-y-2 p-3">
          <div
            className="p-3"
            style={{
              background: theme.tokens.surface,
              borderRadius: theme.tokens.radiusCard,
              border: `${theme.tokens.borderWidth} solid ${theme.tokens.border}`,
              boxShadow: variables['--tema-sombra'],
            }}
          >
            <p style={{ color: theme.tokens.text, fontWeight: Number(theme.tokens.headingWeight) }}>
              Corte de pelo
            </p>
            <p className="text-sm" style={{ color: theme.tokens.textMuted }}>
              30 min · 18 €
            </p>
            <span
              className="mt-2 inline-flex px-3 py-1.5 text-sm font-semibold"
              style={{
                background: theme.tokens.brand,
                color: theme.tokens.brandText,
                borderRadius: theme.tokens.radiusButton,
              }}
            >
              {t('booking.confirm')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Importar                                                                    */
/* -------------------------------------------------------------------------- */

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);

  const importar = useMutation({
    mutationFn: (fichero: ThemeFile) =>
      api.post(`/organizations/${organizationId}/themes/import`, fichero),
    onSuccess: () => {
      setTexto('');
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['themes'] });
    },
  });

  const enviar = () => {
    setError(null);
    try {
      const fichero = JSON.parse(texto) as ThemeFile;
      if (fichero.format !== 'cita-facil-theme') {
        setError(t('admin.themes.importInvalid'));
        return;
      }
      importar.mutate(fichero);
    } catch {
      setError(t('admin.themes.importInvalid'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.themes.importTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={importar.isPending} disabled={!texto.trim()} onClick={enviar}>
            {t('admin.themes.importAction')}
          </Button>
        </>
      }
    >
      <ErrorMessage error={error ?? importar.error} />

      <Field label={t('admin.themes.importTitle')} hint={t('admin.themes.importHint')}>
        <Textarea
          rows={10}
          className="font-mono text-xs"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
        />
      </Field>
    </Modal>
  );
}
