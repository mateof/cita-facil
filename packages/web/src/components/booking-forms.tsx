import { useTranslation } from 'react-i18next';
import type { FormDefinition, SubmitFormResponseInput } from '@cita-facil/shared';
import { renderRichText } from '../lib/richtext.ts';
import { Card, Field, Input, Select, Switch, Textarea } from './ui.tsx';

/**
 * Formularios y consentimientos dentro de la reserva.
 *
 * Se responden antes de confirmar, no después: una cita creada a la que le
 * falta el consentimiento que exige la ley es peor que una reserva que no llega
 * a hacerse, porque nadie la mira hasta que la persona está en la puerta.
 *
 * El texto del consentimiento lo escribe el negocio y se pinta **saneado**,
 * como todo lo que viene de la base de datos: un `<script>` en esa caja robaría
 * la sesión de quien lo lea.
 */

export interface PendingForm extends FormDefinition {
  required: boolean;
  oncePerCustomer: boolean;
}

export type FormAnswers = Record<string, SubmitFormResponseInput>;

/** ¿Está todo lo obligatorio respondido? Es lo que habilita el botón. */
export function formsCompleted(forms: PendingForm[], answers: FormAnswers): boolean {
  return forms.every((form) => {
    if (!form.required) return true;
    const respuesta = answers[form.id];
    if (!respuesta) return false;

    if (form.kind === 'consent') {
      if (!respuesta.accepted) return false;
      return !form.requiresSignature || Boolean(respuesta.signatureName?.trim());
    }

    return form.fields.every((field) => {
      if (!field.required) return true;
      const valor = respuesta.answers[field.key];
      return valor !== undefined && valor !== null && valor !== '' && valor !== false;
    });
  });
}

export function BookingForms({
  forms,
  answers,
  onChange,
}: {
  forms: PendingForm[];
  answers: FormAnswers;
  onChange: (answers: FormAnswers) => void;
}) {
  const { t } = useTranslation();
  if (forms.length === 0) return null;

  const actualizar = (formId: string, patch: Partial<SubmitFormResponseInput>) => {
    const previo = answers[formId] ?? { formId, answers: {}, accepted: false };
    onChange({ ...answers, [formId]: { ...previo, ...patch } });
  };

  const responder = (formId: string, key: string, valor: string | number | boolean) => {
    const previo = answers[formId] ?? { formId, answers: {}, accepted: false };
    actualizar(formId, { answers: { ...previo.answers, [key]: valor } });
  };

  return (
    <>
      {forms.map((form) => {
        const respuesta = answers[form.id];

        return (
          <Card key={form.id} className="mb-4">
            <h2 className="font-semibold">{form.name}</h2>
            {form.description && (
              <p className="mb-3 text-sm text-slate-500">{form.description}</p>
            )}

            {form.kind === 'consent' ? (
              <>
                <div
                  className="prose-sm mb-3 max-h-64 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-700"
                  // El negocio escribe este texto; se pinta saneado.
                  dangerouslySetInnerHTML={{ __html: renderRichText(form.consentText ?? '', 'markdown') }}
                />

                <Switch
                  checked={respuesta?.accepted ?? false}
                  onChange={(value) => actualizar(form.id, { accepted: value })}
                  label={t('booking.consentAccept')}
                />

                {form.requiresSignature && (
                  <Field
                    label={t('booking.signature')}
                    hint={t('booking.signatureHint')}
                    className="mt-2"
                    required
                  >
                    <Input
                      value={respuesta?.signatureName ?? ''}
                      onChange={(event) =>
                        actualizar(form.id, { signatureName: event.target.value })
                      }
                    />
                  </Field>
                )}
              </>
            ) : (
              form.fields.map((field) => {
                const valor = respuesta?.answers[field.key];

                if (field.type === 'checkbox') {
                  return (
                    <Switch
                      key={field.key}
                      checked={valor === true}
                      onChange={(value) => responder(form.id, field.key, value)}
                      label={field.label}
                      hint={field.hint ?? undefined}
                    />
                  );
                }

                return (
                  <Field
                    key={field.key}
                    label={field.label}
                    hint={field.hint ?? undefined}
                    required={field.required}
                  >
                    {field.type === 'textarea' ? (
                      <Textarea
                        value={(valor as string) ?? ''}
                        onChange={(event) => responder(form.id, field.key, event.target.value)}
                      />
                    ) : field.type === 'select' ? (
                      <Select
                        value={(valor as string) ?? ''}
                        onChange={(event) => responder(form.id, field.key, event.target.value)}
                      >
                        <option value="">{t('common.choose')}</option>
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={(valor as string) ?? ''}
                        onChange={(event) =>
                          responder(
                            form.id,
                            field.key,
                            field.type === 'number' ? Number(event.target.value) : event.target.value,
                          )
                        }
                      />
                    )}
                  </Field>
                );
              })
            )}
          </Card>
        );
      })}
    </>
  );
}
