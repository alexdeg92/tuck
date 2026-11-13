import type { ApiErrorDetail } from '@todo/contracts';
import type { z } from 'zod';
import { validationFailed } from '../errors';

const toDetails = (error: z.ZodError): ApiErrorDetail[] =>
  error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));

export const parseInput = <Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> => {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed('Request validation failed', toDetails(result.error));
  return result.data;
};
