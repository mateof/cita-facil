import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Formularios y consentimientos.
 *
 * Un formulario pregunta lo que hace falta saber antes de atender; un
 * consentimiento enseña un texto y pide aceptarlo con fecha y firma. Comparten
 * estructura porque comparten recorrido: se piden al reservar, se responden una
 * vez y se guardan en la ficha de la persona.
 */

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'checkbox',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const formFieldSchema = z.object({
  /** Identificador estable del campo dentro del formulario. */
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Solo minúsculas, números y guion bajo'),
  label: z.string().min(1).max(160),
  type: z.enum(FORM_FIELD_TYPES).default('text'),
  required: z.boolean().default(false),
  hint: z.string().max(200).nullish(),
  /** Solo en `select`. */
  options: z.array(z.string().min(1).max(120)).max(50).default([]),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const FORM_KINDS = ['form', 'consent'] as const;
export type FormKind = (typeof FORM_KINDS)[number];

export const createFormSchema = z.object({
  name: z.string().min(1).max(140).trim(),
  description: z.string().max(500).nullish(),
  kind: z.enum(FORM_KINDS).default('form'),
  fields: z.array(formFieldSchema).max(50).default([]),
  /** Texto del consentimiento. Se pinta saneado, nunca en crudo. */
  consentText: z.string().max(20_000).nullish(),
  requiresSignature: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = createFormSchema.partial();

export const formSchema = createFormSchema.extend({
  id: idSchema,
  organizationId: idSchema,
  createdAt: z.string(),
});
export type FormDefinition = z.infer<typeof formSchema>;

/** Qué formulario pide un servicio y en qué condiciones. */
export const serviceFormSchema = z.object({
  formId: idSchema,
  required: z.boolean().default(true),
  /** Se pide una sola vez por persona, no en cada cita. */
  oncePerCustomer: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type ServiceFormLink = z.infer<typeof serviceFormSchema>;

/** Formulario pendiente tal y como se le ofrece a quien reserva. */
export const pendingFormSchema = formSchema.extend({
  required: z.boolean(),
  oncePerCustomer: z.boolean(),
});

export const formAnswerSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const submitFormResponseSchema = z.object({
  formId: idSchema,
  answers: formAnswerSchema.default({}),
  /** Consentimientos: aceptación explícita y firma escrita. */
  accepted: z.boolean().default(false),
  signatureName: z.string().max(140).nullish(),
});
export type SubmitFormResponseInput = z.infer<typeof submitFormResponseSchema>;

export const formResponseSchema = z.object({
  id: idSchema,
  formId: idSchema,
  formName: z.string(),
  kind: z.enum(FORM_KINDS),
  appointmentId: idSchema.nullable(),
  customerId: idSchema.nullable(),
  guestName: z.string().nullable(),
  answers: formAnswerSchema,
  acceptedAt: z.string().nullable(),
  signatureName: z.string().nullable(),
  createdAt: z.string(),
});
export type FormResponse = z.infer<typeof formResponseSchema>;
