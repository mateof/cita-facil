import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ticket } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDate, formatMoney } from '../lib/format.ts';
import type { CreditBalance, CreditPack, CreditWallet } from '../lib/types.ts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  LoadingBlock,
  PageHeader,
  Select,
} from '../components/ui.tsx';

interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
}

/**
 * Bonos del cliente: lo que le queda y lo que puede comprar.
 *
 * El saldo es por organización, así que en una instalación con varios negocios
 * aparece un selector. En la habitual, con uno solo, no se ve.
 */
export default function MyCredits() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const organizations = useQuery({
    queryKey: ['public-organizations'],
    queryFn: () => api.get<OrganizationSummary[]>('/public/organizations'),
  });

  const active = organizationId ?? organizations.data?.[0]?.id ?? null;

  const balance = useQuery({
    enabled: Boolean(active),
    queryKey: ['credit-balance', active],
    queryFn: () => api.get<CreditBalance>(`/organizations/${active}/credits/balance`),
  });

  const buy = useMutation({
    mutationFn: (packId: string) =>
      api.post<{ redirectUrl: string | null; formPost: { action: string; fields: Record<string, string> } | null }>(
        `/organizations/${active}/payments/checkout`,
        { creditPackId: packId, returnUrl: `${window.location.origin}/mis-bonos` },
      ),
    onSuccess: (data) => {
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      if (data.formPost) submitToGateway(data.formPost);
    },
  });

  return (
    <div>
      <PageHeader title={t('credits.title')} description={t('credits.description')} />

      {(organizations.data?.length ?? 0) > 1 && (
        <Select
          className="mb-4"
          value={active ?? ''}
          onChange={(event) => setOrganizationId(event.target.value)}
          aria-label={t('credits.organization')}
        >
          {organizations.data?.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
      )}

      {balance.isLoading && <LoadingBlock rows={3} />}
      <ErrorMessage error={buy.error} />

      {balance.data && (
        <>
          <Card className="mb-4 flex items-center gap-4">
            <Ticket className="size-8 text-brand" aria-hidden />
            <div>
              <p className="text-2xl font-bold tabular-nums">{balance.data.available}</p>
              <p className="text-sm text-slate-500">{t('credits.available')}</p>
            </div>
          </Card>

          {balance.data.wallets.length === 0 && balance.data.packsForSale.length === 0 && (
            <EmptyState
              icon={<Ticket className="size-10" />}
              title={t('credits.empty')}
              description={t('credits.emptyHint')}
            />
          )}

          {balance.data.wallets.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('credits.mine')}</h2>
              <ul className="space-y-2">
                {balance.data.wallets.map((wallet) => (
                  <WalletCard key={wallet.id} wallet={wallet} locale={locale} />
                ))}
              </ul>
            </section>
          )}

          {balance.data.packsForSale.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('credits.forSale')}</h2>
              <ul className="space-y-2">
                {balance.data.packsForSale.map((pack) => (
                  <PackCard
                    key={pack.id}
                    pack={pack}
                    locale={locale}
                    buying={buy.isPending}
                    onBuy={() => buy.mutate(pack.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function WalletCard({ wallet, locale }: { wallet: CreditWallet; locale: string }) {
  const { t } = useTranslation();
  const percentage = wallet.total > 0 ? (wallet.remaining / wallet.total) * 100 : 0;

  return (
    <Card as="li">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          {wallet.packName}
          {wallet.status !== 'active' && (
            <Badge className="bg-slate-200">{t(`credits.status.${wallet.status}`)}</Badge>
          )}
        </p>
        <p className="tabular-nums text-sm text-slate-600">
          {t('credits.remainingOf', { remaining: wallet.remaining, total: wallet.total })}
        </p>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percentage}%` }} />
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {wallet.serviceNames.length > 0 ? wallet.serviceNames.join(', ') : t('credits.allServices')}
        {wallet.expiresAt && ` · ${t('credits.until', { date: formatDate(wallet.expiresAt, locale) })}`}
      </p>
    </Card>
  );
}

function PackCard({
  pack,
  locale,
  buying,
  onBuy,
}: {
  pack: CreditPack;
  locale: string;
  buying: boolean;
  onBuy: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card as="li" className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold">{pack.name}</p>
        <p className="text-sm text-slate-500">
          {t('credits.sessionsCount', { count: pack.credits })}
          {' · '}
          {formatMoney(pack.priceCents, pack.currency, locale)}
          {pack.validityDays > 0 && ` · ${t('credits.validFor', { days: pack.validityDays })}`}
        </p>
        {pack.description && <p className="mt-0.5 text-xs text-slate-500">{pack.description}</p>}
      </div>
      <Button loading={buying} onClick={onBuy}>
        {t('credits.buy')}
      </Button>
    </Card>
  );
}

/**
 * Redsys no admite una redirección con `GET`: hay que publicar un formulario
 * contra el TPV con los campos firmados.
 */
function submitToGateway(formPost: { action: string; fields: Record<string, string> }): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = formPost.action;
  for (const [name, value] of Object.entries(formPost.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}
