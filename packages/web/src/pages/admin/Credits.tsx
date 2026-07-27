import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ban, Pencil, Plus, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import type {
  AdminService,
  CreditPack,
  CreditWallet,
  CreditWalletStatus,
} from '../../lib/types.ts';
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
  Tabs,
  Textarea,
} from '../../components/ui.tsx';
import { Combobox } from '../../components/combobox.tsx';
import { CustomerPicker, toOptions } from '../../components/pickers.tsx';
import { AvatarPicker } from '../../components/avatar-picker.tsx';
import { EntityAvatar } from '../../components/avatar.tsx';

/**
 * Bonos: series de sesiones prepagadas.
 *
 * Dos pestañas porque son dos trabajos distintos. "Tipos" es configuración,
 * se toca de vez en cuando. "Emitidos" es el día a día del mostrador: quién
 * tiene saldo, a quién hay que darle un bono y cuál hay que anular.
 */
export default function Credits() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('packs');

  return (
    <div>
      <PageHeader title={t('admin.credits.title')} description={t('admin.credits.description')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'packs', label: t('admin.credits.packs') },
          { id: 'wallets', label: t('admin.credits.issued') },
        ]}
      />
      {tab === 'packs' && <PacksTab />}
      {tab === 'wallets' && <WalletsTab />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tipos de bono                                                              */
/* -------------------------------------------------------------------------- */

type PackDraft = Partial<CreditPack>;

const EMPTY_PACK: PackDraft = {
  name: '',
  description: '',
  credits: 10,
  priceCents: 0,
  currency: 'EUR',
  validityDays: 365,
  serviceIds: [],
  onlinePurchase: true,
  sortOrder: 0,
  active: true,
};

function PacksTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PackDraft | null>(null);

  const packs = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['credit-packs', organizationId],
    queryFn: () => api.get<CreditPack[]>(`/organizations/${organizationId}/credit-packs`),
  });

  const services = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['services', organizationId],
    queryFn: () => api.get<AdminService[]>(`/organizations/${organizationId}/services`),
  });

  const save = useMutation({
    mutationFn: (input: PackDraft) => {
      const body = {
        name: input.name,
        description: input.description || undefined,
        credits: input.credits,
        priceCents: input.priceCents,
        currency: input.currency,
        validityDays: input.validityDays,
        serviceIds: input.serviceIds ?? [],
        onlinePurchase: input.onlinePurchase,
        sortOrder: input.sortOrder,
        active: input.active,
        imageUrl: input.imageUrl ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
      };
      return input.id
        ? api.patch(`/organizations/${organizationId}/credit-packs/${input.id}`, body)
        : api.post(`/organizations/${organizationId}/credit-packs`, body);
    },
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['credit-packs'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/organizations/${organizationId}/credit-packs/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['credit-packs'] }),
  });

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setDraft({ ...EMPTY_PACK })}>
          {t('admin.credits.newPack')}
        </Button>
      </div>

      {packs.isLoading && <LoadingBlock rows={3} />}
      <ErrorMessage error={remove.error} />

      {packs.data?.length === 0 && (
        <Card>
          <p className="text-sm text-slate-500">{t('admin.credits.noPacks')}</p>
        </Card>
      )}

      <ul className="space-y-2">
        {packs.data?.map((pack) => (
          <Card as="li" key={pack.id} className="flex flex-wrap items-center gap-3">
            <EntityAvatar
              name={pack.name}
              avatar={{ imageUrl: pack.imageUrl, icon: pack.icon, color: pack.color }}
              square
            />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {pack.name}
                {!pack.active && <Badge className="bg-slate-200">{t('admin.credits.inactive')}</Badge>}
                {pack.onlinePurchase ? (
                  <Badge className="bg-emerald-100 text-emerald-800">
                    {t('admin.credits.online')}
                  </Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800">
                    {t('admin.credits.onsiteOnly')}
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {t('admin.credits.sessionsCount', { count: pack.credits })}
                {' · '}
                {formatMoney(pack.priceCents, pack.currency, locale)}
                {' · '}
                {pack.validityDays > 0
                  ? t('admin.credits.validFor', { days: pack.validityDays })
                  : t('admin.credits.noExpiry')}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {pack.serviceNames.length > 0
                  ? pack.serviceNames.join(', ')
                  : t('admin.credits.allServices')}
                {pack.issuedCount !== undefined &&
                  ` · ${t('admin.credits.issuedCount', { count: pack.issuedCount })}`}
              </p>
            </div>

            <div className="flex gap-1">
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label={t('common.edit')}
                onClick={() => setDraft({ ...pack })}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={t('common.delete')}
                onClick={() => remove.mutate(pack.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </Card>
        ))}
      </ul>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('common.edit') : t('admin.credits.newPack')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <PackForm
            draft={draft}
            services={services.data ?? []}
            error={save.error}
            onChange={setDraft}
          />
        )}
      </Modal>
    </div>
  );
}

function PackForm({
  draft,
  services,
  error,
  onChange,
}: {
  draft: PackDraft;
  services: AdminService[];
  error: unknown;
  onChange: (draft: PackDraft) => void;
}) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const set = (patch: PackDraft) => onChange({ ...draft, ...patch });

  return (
    <div>
      <ErrorMessage error={error} />

      <Field label={t('admin.credits.packName')} required>
        <Input value={draft.name ?? ''} onChange={(event) => set({ name: event.target.value })} />
      </Field>

      <Field label={t('avatar.fieldLabel')}>
        <AvatarPicker
          name={draft.name ?? ''}
          target="credit_pack"
          organizationId={organizationId}
          value={{ imageUrl: draft.imageUrl, icon: draft.icon, color: draft.color }}
          onChange={(avatar) => set(avatar)}
        />
      </Field>

      <Field label={t('admin.services.description')}>
        <Textarea
          value={draft.description ?? ''}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.credits.sessions')} required>
          <Input
            type="number"
            min={1}
            value={draft.credits ?? 10}
            onChange={(event) => set({ credits: Number(event.target.value) })}
          />
        </Field>
        <Field label={`${t('admin.price')} (céntimos)`}>
          <Input
            type="number"
            min={0}
            value={draft.priceCents ?? 0}
            onChange={(event) => set({ priceCents: Number(event.target.value) })}
          />
        </Field>
        <Field label={t('admin.credits.validityDays')} hint={t('admin.credits.validityHint')}>
          <Input
            type="number"
            min={0}
            value={draft.validityDays ?? 365}
            onChange={(event) => set({ validityDays: Number(event.target.value) })}
          />
        </Field>
        <Field label={t('admin.credits.sortOrder')}>
          <Input
            type="number"
            min={0}
            value={draft.sortOrder ?? 0}
            onChange={(event) => set({ sortOrder: Number(event.target.value) })}
          />
        </Field>
      </div>

      <Field label={t('admin.credits.services')} hint={t('admin.credits.servicesHint')}>
        <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-3">
          {services.length === 0 && <p className="text-sm text-slate-500">{t('common.empty')}</p>}
          {services.map((service) => (
            <label key={service.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(draft.serviceIds ?? []).includes(service.id)}
                onChange={(event) =>
                  set({
                    serviceIds: event.target.checked
                      ? [...(draft.serviceIds ?? []), service.id]
                      : (draft.serviceIds ?? []).filter((id) => id !== service.id),
                  })
                }
                className="size-4 rounded border-slate-300"
              />
              {service.name}
              {service.requiresCreditPack && (
                <Badge className="bg-brand-soft text-brand">{t('admin.credits.needsPass')}</Badge>
              )}
            </label>
          ))}
        </div>
      </Field>

      <div className="divide-y divide-slate-100">
        <Switch
          checked={draft.onlinePurchase ?? true}
          onChange={(value) => set({ onlinePurchase: value })}
          label={t('admin.credits.onlinePurchase')}
          hint={t('admin.credits.onlinePurchaseHint')}
        />
        <Switch
          checked={draft.active ?? true}
          onChange={(value) => set({ active: value })}
          label={t('admin.credits.activePack')}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bonos emitidos                                                             */
/* -------------------------------------------------------------------------- */

const STATUS_STYLES: Record<CreditWalletStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  exhausted: 'bg-slate-200 text-slate-700',
  expired: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-red-100 text-red-800',
};

/**
 * Bonos emitidos.
 *
 * Es una tabla con sus filtros encima, y el alta va entera en su propio
 * diálogo. Antes los filtros estaban en la misma fila que el botón de entregar
 * y parecían parte del alta: había que escribir el nombre ahí y elegir estado
 * antes de pulsar, cuando en realidad no tenían nada que ver.
 */
function WalletsTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [packId, setPackId] = useState('');
  const [granting, setGranting] = useState(false);
  const [editing, setEditing] = useState<CreditWallet | null>(null);

  const packs = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['credit-packs', organizationId],
    queryFn: () => api.get<CreditPack[]>(`/organizations/${organizationId}/credit-packs`),
  });

  const wallets = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['credit-wallets', organizationId, search, status, packId],
    queryFn: () =>
      api.get<CreditWallet[]>(`/organizations/${organizationId}/credit-wallets`, {
        query: {
          query: search || undefined,
          status: status || undefined,
          packId: packId || undefined,
        },
      }),
  });

  const adjust = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/organizations/${organizationId}/credit-wallets/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['credit-wallets'] }),
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <fieldset className="flex flex-wrap items-end gap-3">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {t('admin.credits.filters')}
          </legend>

          <Field label={t('common.search')} className="mb-0 w-56">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('admin.credits.searchHint')}
            />
          </Field>
          <Field label={t('admin.credits.filterByPack')} className="mb-0 w-52">
            <Combobox
              value={packId || null}
              options={toOptions(packs.data, (pack) => pack.name)}
              placeholder={t('common.all')}
              onChange={(id) => setPackId(id ?? '')}
            />
          </Field>
          <Field label={t('common.status')} className="mb-0 w-40">
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="active">{t('admin.credits.statusActive')}</option>
              <option value="exhausted">{t('admin.credits.statusExhausted')}</option>
              <option value="expired">{t('admin.credits.statusExpired')}</option>
              <option value="cancelled">{t('admin.credits.statusCancelled')}</option>
            </Select>
          </Field>
        </fieldset>

        <Button icon={<UserPlus className="size-4" />} onClick={() => setGranting(true)}>
          {t('admin.credits.grant')}
        </Button>
      </div>

      <ErrorMessage error={adjust.error} />
      {wallets.isLoading && <LoadingBlock rows={4} />}

      {wallets.data?.length === 0 && (
        <p className="py-4 text-sm text-slate-500">{t('admin.credits.noWallets')}</p>
      )}

      {wallets.data && wallets.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('admin.credits.columnPerson')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('admin.credits.columnPack')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('admin.credits.columnSessions')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('admin.credits.columnExpiry')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('admin.credits.columnStatus')}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t('admin.credits.columnActions')}
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {wallets.data.map((wallet) => (
                <tr key={wallet.id}>
                  <td className="py-2.5 pr-3">
                    <span className="block font-medium text-slate-900">
                      {wallet.userName ?? wallet.userEmail}
                    </span>
                    {wallet.userName && wallet.userEmail && (
                      <span className="block text-xs text-slate-500">{wallet.userEmail}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">{wallet.packName}</td>
                  <td className="py-2.5 pr-3 tabular-nums">
                    {t('admin.credits.remainingOf', {
                      remaining: wallet.remaining,
                      total: wallet.total,
                    })}
                  </td>
                  <td className="py-2.5 pr-3">
                    {wallet.expiresAt
                      ? formatDate(wallet.expiresAt, locale)
                      : t('admin.credits.noExpiryShort')}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge className={STATUS_STYLES[wallet.status]}>
                      {t(
                        `admin.credits.status${wallet.status.charAt(0).toUpperCase()}${wallet.status.slice(1)}`,
                      )}
                    </Badge>
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                        aria-label={t('admin.credits.addOne')}
                        onClick={() => adjust.mutate({ id: wallet.id, patch: { delta: 1 } })}
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                        aria-label={t('common.edit')}
                        onClick={() => setEditing(wallet)}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                        aria-label={
                          wallet.status === 'cancelled'
                            ? t('admin.credits.restore')
                            : t('admin.credits.cancel')
                        }
                        onClick={() =>
                          adjust.mutate({
                            id: wallet.id,
                            patch: { cancelled: wallet.status !== 'cancelled' },
                          })
                        }
                      >
                        {wallet.status === 'cancelled' ? (
                          <RotateCcw className="size-4" />
                        ) : (
                          <Ban className="size-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GrantModal open={granting} onClose={() => setGranting(false)} />
      <EditWalletModal wallet={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function GrantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ userId: '', packId: '', credits: '', note: '' });

  const packs = useQuery({
    enabled: open && Boolean(organizationId),
    queryKey: ['credit-packs', organizationId],
    queryFn: () => api.get<CreditPack[]>(`/organizations/${organizationId}/credit-packs`),
  });

  const grant = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${organizationId}/credit-wallets`, {
        userId: draft.userId,
        packId: draft.packId,
        credits: draft.credits ? Number(draft.credits) : undefined,
        note: draft.note || undefined,
      }),
    onSuccess: () => {
      setDraft({ userId: '', packId: '', credits: '', note: '' });
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['credit-wallets'] });
    },
  });

  const opcionesDeBono = toOptions(
    packs.data,
    (pack) => pack.name,
    (pack) => t('admin.credits.sessionsCount', { count: pack.credits }),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.credits.grant')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={grant.isPending}
            disabled={!draft.userId || !draft.packId}
            onClick={() => grant.mutate()}
          >
            {t('admin.credits.grantAction')}
          </Button>
        </>
      }
    >
      <ErrorMessage error={grant.error} />
      <p className="mb-4 text-sm text-slate-500">{t('admin.credits.grantHint')}</p>

      <Field label={t('admin.credits.person')} hint={t('admin.credits.personHint')} required>
        <CustomerPicker
          value={draft.userId || null}
          onChange={(userId) => setDraft((current) => ({ ...current, userId: userId ?? '' }))}
        />
      </Field>

      <Field label={t('admin.credits.pack')} hint={t('admin.credits.packHint')} required>
        <Combobox
          value={draft.packId || null}
          options={opcionesDeBono}
          onChange={(packId) => setDraft((current) => ({ ...current, packId: packId ?? '' }))}
        />
      </Field>

      <Field label={t('admin.credits.customCredits')} hint={t('admin.credits.customCreditsHint')}>
        <Input
          type="number"
          min={1}
          value={draft.credits}
          onChange={(event) => setDraft({ ...draft, credits: event.target.value })}
        />
      </Field>

      <Field label={t('admin.credits.note')}>
        <Input
          value={draft.note}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        />
      </Field>
    </Modal>
  );
}

/**
 * Edición de un bono ya entregado.
 *
 * Las sesiones se escriben como total y no como diferencia, que es como lo
 * piensa quien atiende: "este bono es de 10". El API traduce ese total a la
 * diferencia que anota en el histórico.
 */
function EditWalletModal({
  wallet,
  onClose,
}: {
  wallet: CreditWallet | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({ total: '', expiresAt: '', note: '' });
  const cargado = useRef('');

  // Se rellena una sola vez por bono: si se copiara en cada render, cualquier
  // refresco de la lista borraría lo que se esté escribiendo.
  useEffect(() => {
    if (!wallet || cargado.current === wallet.id) return;
    cargado.current = wallet.id;
    setDraft({
      total: String(wallet.total),
      expiresAt: wallet.expiresAt ? wallet.expiresAt.slice(0, 10) : '',
      note: wallet.note ?? '',
    });
  }, [wallet]);

  /**
   * Solo se manda lo que ha cambiado.
   *
   * Además de no pisar campos que nadie ha tocado, hace que el fallo se note:
   * mandando siempre los tres, un servidor que no entienda alguno responde que
   * sí y guarda los otros, y el cambio se pierde sin aviso.
   */
  const cambios = (): Record<string, unknown> => {
    if (!wallet) return {};
    const patch: Record<string, unknown> = {};
    const total = Number(draft.total);
    const caducidad = draft.expiresAt ? `${draft.expiresAt}T00:00:00.000Z` : null;

    if (Number.isFinite(total) && total !== wallet.total) patch.total = total;
    if (caducidad !== (wallet.expiresAt ?? null)) patch.expiresAt = caducidad;
    if (draft.note !== (wallet.note ?? '')) patch.note = draft.note;
    return patch;
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/organizations/${organizationId}/credit-wallets/${wallet!.id}`, cambios()),
    onSuccess: () => {
      cargado.current = '';
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['credit-wallets'] });
    },
  });

  const guardar = () => {
    // Sin cambios no hay nada que pedirle al servidor, que además lo rechazaría.
    if (Object.keys(cambios()).length === 0) {
      cargado.current = '';
      onClose();
      return;
    }
    save.mutate();
  };

  return (
    <Modal
      open={wallet !== null}
      onClose={onClose}
      title={t('admin.credits.editWallet')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={guardar}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {wallet && (
        <>
          <ErrorMessage error={save.error} />
          <p className="mb-4 text-sm text-slate-500">
            {wallet.userName ?? wallet.userEmail} · {wallet.packName}
          </p>

          <Field
            label={t('admin.credits.totalSessions')}
            hint={t('admin.credits.usedSessions', { count: wallet.used })}
            required
          >
            <Input
              type="number"
              min={wallet.used}
              value={draft.total}
              onChange={(event) => setDraft({ ...draft, total: event.target.value })}
            />
          </Field>

          <Field label={t('admin.credits.expiresAt')} hint={t('admin.credits.expiresAtHint')}>
            <Input
              type="date"
              value={draft.expiresAt}
              onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
            />
          </Field>

          <Field label={t('admin.credits.note')}>
            <Input
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </Field>
        </>
      )}
    </Modal>
  );
}
