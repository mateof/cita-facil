import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  MapPin,
  Sparkles,
  Ticket,
  User,
} from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '../lib/api.ts';
import { EntityAvatar } from '../components/avatar.tsx';
import {
  addDaysIso,
  formatDate,
  formatDuration,
  formatMoney,
  formatTime,
  isoWeekday,
  todayIso,
} from '../lib/format.ts';
import { useAuth } from '../stores/auth.ts';
import type {
  Appointment,
  Availability,
  CreditEligibility,
  PublicOrganization,
  PublicService,
  Slot,
} from '../lib/types.ts';
import { OrganizationFooter } from '../components/OrganizationFooter.tsx';
import { OrganizationReviews, RatingChip } from '../components/reviews.tsx';
import { WalkInQueue } from '../components/walk-in.tsx';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Textarea,
} from '../components/ui.tsx';

type Step = 'service' | 'duration' | 'when' | 'confirm' | 'done';

/**
 * Asistente de reserva.
 *
 * Está pensado para el pulgar: un paso por pantalla, botones grandes y la
 * acción principal siempre visible abajo. La duración ajustable aparece como
 * un paso propio solo cuando el servicio lo permite, para no añadir ruido en
 * los servicios de duración fija, que son la mayoría.
 */
export default function Book() {
  const { slug = '' } = useParams();
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((state) => state.user);

  const [step, setStep] = useState<Step>('service');
  const [serviceId, setServiceId] = useState<string | null>(searchParams.get('servicio'));
  const [locationId, setLocationId] = useState<string | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [date, setDate] = useState<string>(searchParams.get('fecha') ?? '');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [partySize, setPartySize] = useState(1);
  const [notes, setNotes] = useState('');
  const [guest, setGuest] = useState({ name: '', email: '', phone: '' });
  const [created, setCreated] = useState<Appointment | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-org', slug],
    queryFn: () => api.get<PublicOrganization>(`/public/organizations/${slug}`),
    retry: false,
  });

  const organization = data?.organization;
  const service = data?.services.find((item) => item.id === serviceId) ?? null;

  /**
   * Servicios que solo se reservan con bono. Se pregunta al elegir el
   * servicio, no al confirmar, para no hacer rellenar un formulario que
   * después se va a rechazar.
   */
  const eligibility = useQuery({
    enabled: Boolean(organization && service?.requiresCreditPack),
    queryKey: ['credit-eligibility', organization?.id, serviceId, user?.id ?? null],
    queryFn: () =>
      api.get<CreditEligibility>(`/organizations/${organization?.id}/credits/eligibility`, {
        query: { serviceId: serviceId ?? '' },
      }),
  });

  const blockedByPass = Boolean(
    service?.requiresCreditPack && eligibility.data && !eligibility.data.allowed,
  );

  /*
   * El tema lo aplica el contenedor del portal, que envuelve también a "Mis
   * citas" y compañía. Aquí solo queda el color de marca suelto de los ajustes,
   * para las organizaciones que no tengan tema.
   */
  useEffect(() => {
    if (data?.theme || !organization?.branding.brandColor) return;
    document.documentElement.style.setProperty('--brand', organization.branding.brandColor);
    return () => {
      document.documentElement.style.removeProperty('--brand');
    };
  }, [data?.theme, organization?.branding.brandColor]);

  /**
   * Selección de servicio.
   *
   * La transición de paso se hace aquí y no en un efecto sobre `serviceId`:
   * con un efecto, volver atrás y elegir el mismo servicio otra vez no cambia
   * el estado y por tanto no avanzaba.
   */
  const selectService = (id: string) => {
    const chosen = data?.services.find((item) => item.id === id);
    if (!chosen) return;

    setServiceId(id);
    setDuration(chosen.durationMinutes);
    setLocationId((current) => current ?? chosen.locationId ?? data?.locations[0]?.id ?? null);
    setDate((current) => current || todayIso(data?.organization.timezone));
    setStep(chosen.durationMode === 'flexible' ? 'duration' : 'when');
  };

  /**
   * Enlace directo con `?servicio=`, que es el que llevan los avisos de la
   * lista de espera. Al montar todavía no hay datos cargados, así que el
   * servicio no se puede resolver hasta que llegan.
   */
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    const requested = searchParams.get('servicio');
    if (deepLinkApplied.current || !data || !requested) return;
    deepLinkApplied.current = true;
    selectService(requested);
    // La lista de dependencias es solo `data` a propósito: `selectService` se
    // redefine en cada render y añadirlo repetiría el efecto sin necesidad. El
    // testigo de arriba garantiza que esto ocurra una sola vez.
  }, [data]);

  if (isLoading) return <LoadingBlock rows={4} />;
  if (error || !data || !organization) {
    return <ErrorMessage error={error ?? { message: t('errors.not_found') }} />;
  }

  const locale = i18n.language.slice(0, 2);

  return (
    <div className="pb-4">
      <header className="mb-5">
        {step !== 'service' && step !== 'done' && (
          <button
            type="button"
            onClick={() => setStep(previousStep(step, service))}
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('common.back')}
          </button>
        )}
        <h1 className="text-xl font-bold sm:text-2xl">{organization.name}</h1>
        {step === 'service' && <p className="mt-1 text-sm text-slate-500">{t('booking.chooseService')}</p>}
      </header>

      {step === 'service' && (
        <ServiceStep
          services={data.services}
          categories={data.categories}
          locale={locale}
          onSelect={selectService}
        />
      )}

      {step !== 'service' && step !== 'done' && blockedByPass && eligibility.data && (
        <PassRequired
          eligibility={eligibility.data}
          organizationId={organization.id}
          locale={locale}
        />
      )}

      {step === 'duration' && service && !blockedByPass && (
        <DurationStep
          service={service}
          value={duration ?? service.durationMinutes}
          locale={locale}
          onChange={setDuration}
          onNext={() => setStep('when')}
        />
      )}

      {step === 'when' && service && !blockedByPass && (
        <WhenStep
          organizationId={organization.id}
          timezone={organization.timezone}
          service={service}
          locations={data.locations}
          resources={data.resources}
          locationId={locationId}
          resourceId={resourceId}
          duration={duration ?? service.durationMinutes}
          date={date}
          locale={locale}
          waitlistEnabled={organization.waitlistEnabled}
          onLocationChange={setLocationId}
          onResourceChange={setResourceId}
          onDateChange={setDate}
          onPick={(picked) => {
            setSlot(picked);
            setStep('confirm');
          }}
        />
      )}

      {step === 'confirm' && service && slot && !blockedByPass && (
        <ConfirmStep
          organization={organization}
          service={service}
          slot={slot}
          locationName={data.locations.find((item) => item.id === locationId)?.name ?? ''}
          resourceName={data.resources.find((item) => item.id === slot.resourceIds[0])?.name ?? null}
          duration={duration ?? service.durationMinutes}
          partySize={partySize}
          notes={notes}
          guest={guest}
          isAuthenticated={Boolean(user)}
          locale={locale}
          onPartySizeChange={setPartySize}
          onNotesChange={setNotes}
          onGuestChange={setGuest}
          onDone={(appointment) => {
            setCreated(appointment);
            setStep('done');
          }}
          onNeedsAccount={() => navigate(`/entrar?volver=${encodeURIComponent(location.pathname)}`)}
          locationId={locationId}
          resourceId={resourceId}
        />
      )}

      {step === 'done' && created && <DoneStep appointment={created} locale={locale} />}

      {/* Coger turno es una alternativa a reservar, no un paso de la reserva:
          solo tiene sentido mientras se está eligiendo qué se quiere. */}
      {step === 'service' && data?.organization.walkInPublicJoin && (
        <WalkInQueue organizationId={data.organization.id} />
      )}

      {/* Lo mismo que el pie: las opiniones ayudan a decidir antes de empezar,
          pero estorban cuando ya se está eligiendo la hora. */}
      {step === 'service' && data?.organization.reviewsPublic && (
        <OrganizationReviews organizationId={data.organization.id} />
      )}

      {/* El pie solo aparece mientras se elige servicio: durante la reserva
          estorba, y en el paso final lo que toca es el resguardo. */}
      {step === 'service' && <OrganizationFooter slug={slug} />}
    </div>
  );
}

function previousStep(step: Step, service: PublicService | null): Step {
  if (step === 'confirm') return 'when';
  if (step === 'when') return service?.durationMode === 'flexible' ? 'duration' : 'service';
  return 'service';
}

/* -------------------------------------------------------------------------- */
/* Paso 1: servicio                                                            */
/* -------------------------------------------------------------------------- */

function ServiceStep({
  services,
  categories,
  locale,
  onSelect,
}: {
  services: PublicService[];
  categories: { id: string; name: string }[];
  locale: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; items: PublicService[] }>();
    for (const service of services) {
      const key = service.categoryId ?? '';
      const name = categories.find((category) => category.id === service.categoryId)?.name ?? '';
      const group = groups.get(key) ?? { name, items: [] };
      group.items.push(service);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [services, categories]);

  if (services.length === 0) {
    return <p className="text-slate-500">{t('common.empty')}</p>;
  }

  return (
    <div className="space-y-6">
      {grouped.map((group, index) => (
        <section key={index}>
          {group.name && (
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {group.name}
            </h2>
          )}
          <ul className="space-y-2">
            {group.items.map((service) => (
              <li key={service.id}>
                <button
                  type="button"
                  onClick={() => onSelect(service.id)}
                  data-testid="servicio"
                  data-servicio={service.id}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand hover:shadow-sm"
                >
                  <EntityAvatar
                    name={service.name}
                    avatar={{ imageUrl: service.imageUrl, icon: service.icon, color: service.color }}
                    square
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900">{service.name}</span>
                    {service.description && (
                      <span className="mt-0.5 line-clamp-2 block text-sm text-slate-500">
                        {service.description}
                      </span>
                    )}
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden />
                        {service.durationMode === 'flexible'
                          ? `${service.minDurationMinutes}–${service.maxDurationMinutes} min`
                          : formatDuration(service.durationMinutes, locale)}
                      </span>
                      {service.priceMode !== 'free' && (
                        <span className="font-medium text-slate-700">
                          {service.priceMode === 'per_minute'
                            ? `${formatMoney(service.pricePerMinuteCents ?? 0, service.currency, locale)}/min`
                            : formatMoney(service.priceCents, service.currency, locale)}
                        </span>
                      )}
                      {service.capacity > 1 && (
                        <span className="inline-flex items-center gap-1">
                          <User className="size-3.5" aria-hidden />
                          {service.capacity}
                        </span>
                      )}
                      {service.requiresCreditPack && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">
                          <Ticket className="size-3.5" aria-hidden />
                          {t('booking.withPass')}
                        </span>
                      )}
                      {service.rating && (
                        <RatingChip average={service.rating.average} count={service.rating.count} />
                      )}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Servicios que exigen bono                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Corta la reserva cuando el servicio necesita un bono que la persona no
 * tiene, y ofrece la salida: identificarse o comprar el bono. Aparece en lugar
 * de los pasos siguientes, no encima, para que quede claro que no se puede
 * continuar.
 */
function PassRequired({
  eligibility,
  organizationId,
  locale,
}: {
  eligibility: CreditEligibility;
  organizationId: string;
  locale: string;
}) {
  const { t } = useTranslation();

  return (
    <Card data-testid="bono-necesario" className="border-amber-200 bg-amber-50">
      <p className="flex items-center gap-2 font-semibold text-amber-900">
        <Ticket className="size-5" aria-hidden />
        {t('booking.passRequired')}
      </p>
      <p className="mt-1 text-sm text-amber-900">
        {eligibility.reason === 'anonymous'
          ? t('booking.passAnonymous')
          : t('booking.passNoCredits')}
      </p>

      {eligibility.reason === 'anonymous' ? (
        <Link to="/entrar?volver=/mis-bonos" className="btn-primary mt-3 inline-flex">
          {t('auth.signIn')}
        </Link>
      ) : (
        <>
          {eligibility.packsForSale.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {eligibility.packsForSale.map((pack) => (
                <li key={pack.id} className="text-sm text-amber-900">
                  {pack.name} · {t('credits.sessionsCount', { count: pack.credits })} ·{' '}
                  {formatMoney(pack.priceCents, pack.currency, locale)}
                </li>
              ))}
            </ul>
          )}
          <Link to="/mis-bonos" className="btn-primary mt-3 inline-flex" data-organizacion={organizationId}>
            {eligibility.packsForSale.length > 0 ? t('credits.buy') : t('credits.title')}
          </Link>
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Paso 2: duración ajustable                                                  */
/* -------------------------------------------------------------------------- */

function DurationStep({
  service,
  value,
  locale,
  onChange,
  onNext,
}: {
  service: PublicService;
  value: number;
  locale: string;
  onChange: (minutes: number) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const min = service.minDurationMinutes ?? service.durationMinutes;
  const max = service.maxDurationMinutes ?? service.durationMinutes;
  const step = service.durationStepMinutes ?? 15;

  const options = useMemo(() => {
    const list: number[] = [];
    for (let minutes = min; minutes <= max; minutes += step) list.push(minutes);
    return list;
  }, [min, max, step]);

  const price =
    service.priceMode === 'per_minute'
      ? (service.pricePerMinuteCents ?? 0) * value
      : service.priceCents;

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">{t('booking.chooseDuration')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('booking.durationHelp', { min, max })}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => onChange(minutes)}
            aria-pressed={value === minutes}
            data-testid="duracion"
            data-minutos={minutes}
            className={clsx(
              'rounded-xl border px-3 py-4 text-center transition',
              value === minutes
                ? 'border-brand bg-brand-soft font-semibold text-brand'
                : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <span className="block text-base">{formatDuration(minutes, locale)}</span>
            {service.priceMode === 'per_minute' && (
              <span className="mt-0.5 block text-xs text-slate-500">
                {formatMoney((service.pricePerMinuteCents ?? 0) * minutes, service.currency, locale)}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="sticky bottom-20 mt-6 sm:bottom-4">
        <Button fullWidth onClick={onNext} icon={<ChevronRight className="size-4" />}>
          {t('common.next')}
          {price > 0 && ` · ${formatMoney(price, service.currency, locale)}`}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Paso 3: día y hora                                                          */
/* -------------------------------------------------------------------------- */

function WhenStep({
  organizationId,
  timezone,
  service,
  locations,
  resources,
  locationId,
  resourceId,
  duration,
  date,
  locale,
  waitlistEnabled,
  onLocationChange,
  onResourceChange,
  onDateChange,
  onPick,
}: {
  organizationId: string;
  timezone: string;
  service: PublicService;
  locations: PublicOrganization['locations'];
  resources: PublicOrganization['resources'];
  locationId: string | null;
  resourceId: string | null;
  duration: number;
  date: string;
  locale: string;
  waitlistEnabled: boolean;
  onLocationChange: (id: string) => void;
  onResourceChange: (id: string | null) => void;
  onDateChange: (date: string) => void;
  onPick: (slot: Slot) => void;
}) {
  const { t } = useTranslation();
  const today = todayIso(timezone);
  const [weekStart, setWeekStart] = useState(() => date || today);

  const eligibleResources = resources.filter(
    (resource) =>
      service.resourceIds.includes(resource.id) &&
      (!locationId || resource.locationId === locationId),
  );

  /* Días con hueco de la semana visible, para resaltarlos en el selector. */
  const calendar = useQuery({
    queryKey: ['calendar', organizationId, service.id, weekStart, duration, locationId],
    queryFn: () =>
      api.get<{ days: { date: string; available: boolean; slots: number }[] }>(
        `/public/organizations/${organizationId}/calendar`,
        {
          query: {
            serviceId: service.id,
            from: weekStart,
            to: addDaysIso(weekStart, 13),
            durationMinutes: duration,
            locationId: locationId ?? undefined,
          },
        },
      ),
  });

  const availability = useQuery({
    queryKey: ['availability', organizationId, service.id, date, duration, locationId, resourceId],
    queryFn: () =>
      api.get<Availability>(`/public/organizations/${organizationId}/availability`, {
        query: {
          serviceId: service.id,
          from: date,
          durationMinutes: duration,
          locationId: locationId ?? undefined,
          resourceId: resourceId ?? undefined,
        },
      }),
    enabled: Boolean(date),
  });

  const slots = availability.data?.days[0]?.slots ?? [];
  const groups = useMemo(() => groupSlots(slots), [slots]);

  return (
    <div className="space-y-5">
      {locations.length > 1 && (
        <Field label={t('booking.chooseLocation')}>
          <div className="grid gap-2 sm:grid-cols-2">
            {locations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onLocationChange(item.id)}
                aria-pressed={locationId === item.id}
                className={clsx(
                  'rounded-xl border p-3 text-left text-sm transition',
                  locationId === item.id
                    ? 'border-brand bg-brand-soft'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <span className="block font-medium">{item.name}</span>
                {item.addressLine && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="size-3" aria-hidden />
                    {item.addressLine}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Field>
      )}

      {service.allowResourceSelection && eligibleResources.length > 1 && (
        <Field label={t('booking.chooseResource')}>
          <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
            <ResourceChip
              label={t('booking.anyResource')}
              active={resourceId === null}
              onClick={() => onResourceChange(null)}
            />
            {eligibleResources.map((resource) => (
              <ResourceChip
                key={resource.id}
                label={resource.name}
                active={resourceId === resource.id}
                onClick={() => onResourceChange(resource.id)}
              />
            ))}
          </div>
        </Field>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{t('booking.chooseDate')}</h2>
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
              disabled={weekStart <= today}
              onClick={() => setWeekStart(maxDate(addDaysIso(weekStart, -14), today))}
              aria-label={t('common.previous')}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              onClick={() => setWeekStart(addDaysIso(weekStart, 14))}
              aria-label={t('common.next')}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>

        <div className="scroll-thin flex gap-2 overflow-x-auto pb-2">
          {(calendar.data?.days ?? []).map((day) => {
            const selected = day.date === date;
            return (
              <button
                key={day.date}
                type="button"
                disabled={!day.available}
                onClick={() => onDateChange(day.date)}
                aria-pressed={selected}
                // El botón muestra "LUN 27", que fuera de contexto no dice gran
                // cosa; la etiqueta accesible lleva la fecha completa.
                aria-label={formatDate(`${day.date}T12:00:00.000Z`, locale, timezone, {
                  dateStyle: 'full',
                })}
                data-testid="dia"
                data-date={day.date}
                data-disponible={day.available ? 'si' : 'no'}
                className={clsx(
                  'flex w-16 shrink-0 flex-col items-center rounded-xl border py-2.5 transition',
                  selected
                    ? 'border-brand bg-brand text-white'
                    : day.available
                      ? 'border-slate-200 bg-white hover:border-brand'
                      : 'border-transparent bg-slate-100 text-slate-300',
                )}
              >
                <span className="text-[10px] uppercase">
                  {t(`admin.schedules.weekdays.${isoWeekday(day.date)}`).slice(0, 3)}
                </span>
                <span className="text-lg font-bold tabular-nums">{day.date.slice(8)}</span>
                <span className={clsx('text-[10px]', selected ? 'text-white/80' : 'text-slate-400')}>
                  {day.available ? day.slots : '—'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">{t('booking.chooseTime')}</h2>

        {availability.isLoading && <LoadingBlock rows={2} />}

        {/*
          Un error de red o del servidor no es lo mismo que "no hay huecos".
          Decir que no queda sitio cuando en realidad falló la consulta manda a
          la persona a buscar otro día que tampoco va a poder ver.
        */}
        {availability.isError && (
          <Card>
            <ErrorMessage error={availability.error} />
            <Button variant="secondary" onClick={() => void availability.refetch()}>
              {t('common.retry')}
            </Button>
          </Card>
        )}

        {!availability.isLoading && !availability.isError && slots.length === 0 && (
          <Card className="text-center">
            <p className="text-slate-600">{t('booking.noSlots')}</p>
            <p className="mt-1 text-sm text-slate-500">{t('booking.noSlotsHint')}</p>
            {waitlistEnabled && (
              <WaitlistButton
                organizationId={organizationId}
                serviceId={service.id}
                locationId={locationId}
                date={date}
              />
            )}
          </Card>
        )}

        {groups.map((group) => (
          <div key={group.key} className="mb-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t(`booking.${group.key}`)}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {group.slots.map((item) => (
                <button
                  key={item.startsAt}
                  type="button"
                  onClick={() => onPick(item)}
                  data-testid="hueco"
                  data-inicio={item.startsAt}
                  className="rounded-xl border border-slate-200 bg-white py-2.5 text-center text-sm font-medium tabular-nums transition hover:border-brand hover:bg-brand-soft"
                >
                  {formatTime(item.startsAt, locale, timezone)}
                  {item.remainingCapacity > 1 && (
                    <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                      {t('booking.slotsLeft', { count: item.remainingCapacity })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResourceChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'shrink-0 rounded-full border px-4 py-2 text-sm transition',
        active ? 'border-brand bg-brand text-white' : 'border-slate-200 bg-white hover:border-brand',
      )}
    >
      {label}
    </button>
  );
}

/** Agrupa los huecos en mañana, tarde y noche para no dar una lista infinita. */
function groupSlots(slots: Slot[]): { key: 'morning' | 'afternoon' | 'evening'; slots: Slot[] }[] {
  const morning = slots.filter((slot) => slot.localStartMinute < 14 * 60);
  const afternoon = slots.filter(
    (slot) => slot.localStartMinute >= 14 * 60 && slot.localStartMinute < 19 * 60,
  );
  const evening = slots.filter((slot) => slot.localStartMinute >= 19 * 60);

  return [
    { key: 'morning' as const, slots: morning },
    { key: 'afternoon' as const, slots: afternoon },
    { key: 'evening' as const, slots: evening },
  ].filter((group) => group.slots.length > 0);
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function WaitlistButton({
  organizationId,
  serviceId,
  locationId,
  date,
}: {
  organizationId: string;
  serviceId: string;
  locationId: string | null;
  date: string;
}) {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const [joined, setJoined] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${organizationId}/waitlist`, {
        serviceId,
        locationId: locationId ?? undefined,
        fromDate: date,
        toDate: addDaysIso(date, 14),
      }),
    onSuccess: () => setJoined(true),
  });

  if (!user) {
    return (
      <p className="mt-3 text-sm text-slate-500">
        <Link to="/entrar" className="text-brand hover:underline">
          {t('auth.signIn')}
        </Link>{' '}
        {t('booking.joinWaitlist').toLowerCase()}
      </p>
    );
  }

  if (joined) return <p className="mt-3 text-sm text-emerald-700">{t('booking.waitlistJoined')}</p>;

  return (
    <Button
      variant="secondary"
      className="mt-3"
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {t('booking.joinWaitlist')}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Paso 4: confirmación                                                        */
/* -------------------------------------------------------------------------- */

function ConfirmStep({
  organization,
  service,
  slot,
  locationName,
  resourceName,
  duration,
  partySize,
  notes,
  guest,
  isAuthenticated,
  locale,
  locationId,
  resourceId,
  onPartySizeChange,
  onNotesChange,
  onGuestChange,
  onDone,
  onNeedsAccount,
}: {
  organization: PublicOrganization['organization'];
  service: PublicService;
  slot: Slot;
  locationName: string;
  resourceName: string | null;
  duration: number;
  partySize: number;
  notes: string;
  guest: { name: string; email: string; phone: string };
  isAuthenticated: boolean;
  locale: string;
  locationId: string | null;
  resourceId: string | null;
  onPartySizeChange: (value: number) => void;
  onNotesChange: (value: string) => void;
  onGuestChange: (value: { name: string; email: string; phone: string }) => void;
  onDone: (appointment: Appointment) => void;
  onNeedsAccount: () => void;
}) {
  const { t } = useTranslation();
  const needsGuestData = !isAuthenticated && organization.allowGuestBooking;

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Appointment>(`/organizations/${organization.id}/appointments`, {
        serviceId: service.id,
        locationId: locationId ?? undefined,
        resourceId: resourceId ?? undefined,
        startsAt: slot.startsAt,
        durationMinutes: service.durationMode === 'flexible' ? duration : undefined,
        partySize,
        notes: notes || undefined,
        guest: needsGuestData
          ? { name: guest.name, email: guest.email || undefined, phone: guest.phone || undefined }
          : undefined,
        // Evita duplicar la cita si el botón se pulsa dos veces o hay reintento.
        idempotencyKey: `${slot.startsAt}-${service.id}-${guest.email || 'auth'}`,
      }),
    onSuccess: onDone,
  });

  if (!isAuthenticated && !organization.allowGuestBooking) {
    return (
      <Card className="text-center">
        <p className="mb-4 text-slate-700">{t('errors.guest_booking_disabled')}</p>
        <Button onClick={onNeedsAccount}>{t('auth.signIn')}</Button>
      </Card>
    );
  }

  return (
    <div>
      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">{t('booking.summary')}</h2>
        <dl className="space-y-2 text-sm">
          <Row label={t('admin.service')} value={service.name} />
          <Row
            label={t('common.date')}
            value={`${formatDate(slot.startsAt, locale, organization.timezone, { dateStyle: 'full' })} · ${formatTime(slot.startsAt, locale, organization.timezone)}`}
          />
          <Row label={t('admin.duration')} value={formatDuration(duration, locale)} />
          {locationName && <Row label={t('admin.location')} value={locationName} />}
          {resourceName && <Row label={t('admin.resource')} value={resourceName} />}
          {slot.priceCents > 0 && (
            <Row
              label={t('admin.price')}
              value={formatMoney(slot.priceCents, slot.currency, locale)}
            />
          )}
        </dl>
      </Card>

      {service.capacity > 1 && (
        <Field label={t('booking.people')}>
          <Input
            type="number"
            min={1}
            max={Math.min(service.capacity, slot.remainingCapacity)}
            value={partySize}
            onChange={(event) => onPartySizeChange(Number(event.target.value))}
          />
        </Field>
      )}

      {needsGuestData && (
        <Card className="mb-4">
          <h2 className="mb-3 font-semibold">{t('booking.guestData')}</h2>
          <Field label={t('auth.name')} required>
            <Input
              value={guest.name}
              autoComplete="name"
              onChange={(event) => onGuestChange({ ...guest, name: event.target.value })}
            />
          </Field>
          <Field label={t('auth.email')}>
            <Input
              type="email"
              value={guest.email}
              autoComplete="email"
              onChange={(event) => onGuestChange({ ...guest, email: event.target.value })}
            />
          </Field>
          <Field label={t('auth.phone')} className="mb-0">
            <Input
              type="tel"
              value={guest.phone}
              autoComplete="tel"
              onChange={(event) => onGuestChange({ ...guest, phone: event.target.value })}
            />
          </Field>
        </Card>
      )}

      <Field label={t('booking.notes')}>
        <Textarea
          value={notes}
          placeholder={t('booking.notesPlaceholder')}
          maxLength={2000}
          onChange={(event) => onNotesChange(event.target.value)}
        />
      </Field>

      <ErrorMessage error={mutation.error} />

      <div className="sticky bottom-20 sm:bottom-4">
        <Button
          fullWidth
          loading={mutation.isPending}
          disabled={needsGuestData && guest.name.trim().length < 2}
          onClick={() => mutation.mutate()}
          icon={<CalendarCheck className="size-4" />}
        >
          {mutation.isPending ? t('booking.booking') : t('booking.confirmBooking')}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Paso 5: confirmación final                                                  */
/* -------------------------------------------------------------------------- */

function DoneStep({ appointment, locale }: { appointment: Appointment; locale: string }) {
  const { t } = useTranslation();
  const pending = appointment.status === 'pending';

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100">
        <Sparkles className="size-8 text-emerald-600" aria-hidden />
      </div>
      <h2 className="text-xl font-bold">
        {pending ? t('booking.successPending') : t('booking.successTitle')}
      </h2>
      {pending && <p className="mt-1 text-sm text-slate-500">{t('booking.successPendingHint')}</p>}

      <Card className="mt-5 text-left">
        <dl className="space-y-2 text-sm">
          <Row label={t('admin.service')} value={appointment.serviceName} />
          <Row
            label={t('common.date')}
            value={`${formatDate(appointment.startsAt, locale, appointment.timezone, { dateStyle: 'full' })} · ${formatTime(appointment.startsAt, locale, appointment.timezone)}`}
          />
          <Row label={t('admin.location')} value={appointment.locationName} />
        </dl>

        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t('booking.accessCode')}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-widest">
            {appointment.accessCode}
          </p>
          <img
            src={api.url(
              `/organizations/${appointment.organizationId}/appointments/${appointment.id}/qr`,
            )}
            alt={t('booking.accessCode')}
            className="mx-auto mt-3 size-40"
            loading="lazy"
          />
          <p className="mt-2 text-xs text-slate-500">{t('booking.accessCodeHint')}</p>
        </div>
      </Card>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          icon={<CalendarDays className="size-4" />}
          onClick={() =>
            void api.download(
              `/organizations/${appointment.organizationId}/appointments/${appointment.id}/ics`,
              `cita-${appointment.id}.ics`,
            )
          }
        >
          {t('booking.addToCalendar')}
        </Button>
        <Button
          variant="secondary"
          icon={<Download className="size-4" />}
          onClick={() =>
            void api.download(
              `/organizations/${appointment.organizationId}/appointments/${appointment.id}/receipt`,
              `resguardo-${appointment.id}.pdf`,
            )
          }
        >
          {t('booking.downloadReceipt')}
        </Button>
      </div>

      <Link to="/mis-citas" className="mt-4 inline-block text-sm text-brand hover:underline">
        {t('nav.myAppointments')}
      </Link>
    </div>
  );
}

export { ApiError };
