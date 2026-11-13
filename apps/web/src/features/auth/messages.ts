import type { FieldError } from 'react-hook-form';

export const PASSWORD_LENGTH = 'Use 8–128 characters.';

export function passwordMessage(error: FieldError | undefined): string | undefined {
  if (error === undefined) return undefined;
  return error.type === 'too_small' || error.type === 'too_big' ? PASSWORD_LENGTH : error.message;
}
