import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
// Length over composition rules (NIST 800-63B). Upper bound prevents hash-DoS.
const password = z.string().min(12, 'Use at least 12 characters').max(128);
const token = z.string().min(20).max(200);

export const registerBody = z.object({ email, password, displayName: z.string().trim().min(1).max(80).optional() }).strict();
export const loginBody = z.object({ email, password: z.string().min(1).max(128), totp: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().min(8).max(40).optional() }).strict();
export const totpCodeBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export const disable2faBody = z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }).strict();
export const verifyEmailBody = z.object({ token }).strict();
export const forgotPasswordBody = z.object({ email }).strict();
export const resetPasswordBody = z.object({ token, newPassword: password }).strict();
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict();
export const sessionIdParams = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/) }).strict();
