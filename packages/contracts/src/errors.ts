import { z } from 'zod';

export const ApiErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const API_ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const satisfies Record<ApiErrorCode, number>;

export const ApiErrorDetail = z.object({ path: z.string(), message: z.string() });
export type ApiErrorDetail = z.infer<typeof ApiErrorDetail>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    details: z.array(ApiErrorDetail).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
