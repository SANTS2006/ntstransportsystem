import { normalizePhone } from '@nts/shared';
import { z } from 'zod';

/** Client-side mirrors of the server rules, for fast feedback only. The server is authoritative. */
export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
export const newPassword = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Use at most 128 characters');

/** A phone number typed any usual way; the server stores it in international form. */
export const phone = z
  .string()
  .trim()
  .refine((v) => normalizePhone(v) !== null, 'Enter a valid phone number, like 076 123 456');
export const code = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from the text message');

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
});
export const phoneLoginSchema = z.object({
  phone,
  password: z.string().min(1, 'Enter your password'),
});
export const registerPhoneSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name').max(100),
  phone,
  password: newPassword,
});
export const forgotPhoneSchema = z.object({ phone });
export const verifyCodeSchema = z.object({ code });
export const resetPhoneSchema = z
  .object({ code, password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name').max(100),
  email,
  password: newPassword,
});
export const forgotSchema = z.object({ email });
export const resetSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const recoveryCodeSchema = z.object({
  recoveryCode: z.string().trim().min(8, 'Enter a recovery code').max(40),
});
export const applySchema = z.object({
  name: z.string().trim().min(2, 'Enter the company name').max(120),
  timezone: z.string().trim().min(1, 'Choose a timezone'),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type PhoneLoginValues = z.infer<typeof phoneLoginSchema>;
export type RegisterPhoneValues = z.infer<typeof registerPhoneSchema>;
export type ResetPhoneValues = z.infer<typeof resetPhoneSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ResetValues = z.infer<typeof resetSchema>;
export type ApplyValues = z.infer<typeof applySchema>;
