import { z } from 'zod';

export const UserId = z.uuid();
export type UserId = z.infer<typeof UserId>;

const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

const Password = z.string().min(8).max(128);

export const Credentials = z.strictObject({ email: Email, password: Password });
export type Credentials = z.infer<typeof Credentials>;

/**
 * Sign-up: the credentials plus a confirmation that must match. The rule lives in the
 * contract, so the server enforces it as well as the form; the error lands on confirmPassword.
 */
export const SignUpInput = z
  .strictObject({ email: Email, password: Password, confirmPassword: z.string() })
  .refine(({ password, confirmPassword }) => password === confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });
export type SignUpInput = z.infer<typeof SignUpInput>;

export const User = z.object({ id: UserId, email: z.email() });
export type User = z.infer<typeof User>;

/**
 * Request header for a passive session check (`GET /api/auth/me` with the value `passive`): the
 * server answers who is signed in but does not renew the session, so a tab polling in the
 * background never keeps an idle user signed in.
 */
export const SESSION_CHECK_HEADER = 'X-Session-Check';
export const PASSIVE_SESSION_CHECK = 'passive';
