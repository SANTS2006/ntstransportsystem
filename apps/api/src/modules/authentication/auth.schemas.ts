import { normalizePhone } from '@nts/shared';
import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// Length over composition rules (NIST 800-63B); the upper bound avoids hashing DoS.
export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(128);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
});
/** Any usual way of writing a number; stored as E.164. */
export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => normalizePhone(v) !== null, 'Enter a valid phone number')
  .transform((v) => normalizePhone(v) as string);
export const registerPhoneSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
});
export const phoneOnlySchema = z.object({ phone: phoneSchema });
export const profileSchema = z.object({ displayName: z.string().trim().min(1).max(100) }).strict();
export const emailOnlySchema = z.object({ email: emailSchema });
export const emailCodeSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Enter the 6-character code'),
});
export const phoneCodeSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export const resetPhoneSchema = phoneCodeSchema.extend({ password: passwordSchema });

/** Sign in with an email address or a phone number, never both. */
export const loginSchema = z
  .object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: z.string().min(1).max(128),
  })
  .refine((v) => (v.email === undefined) !== (v.phone === undefined), {
    message: 'Sign in with an email address or a phone number',
    path: ['email'],
  });
export const forgotSchema = z.object({ email: emailSchema });
export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const resetSchema = tokenSchema.extend({ password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
