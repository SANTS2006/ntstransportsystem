import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// Length over composition rules (NIST 800-63B); the upper bound avoids hashing DoS.
export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(128);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
});
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export const forgotSchema = z.object({ email: emailSchema });
export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const resetSchema = tokenSchema.extend({ password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
