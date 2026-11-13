export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== false && part != null && part !== '')
    .join(' ');
}
