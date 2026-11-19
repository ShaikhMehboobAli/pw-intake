import { excavator } from './excavator';
import type { CategoryDef } from './types';

export * from './types';
export { validate, PHOTOS_KEY } from './validate';

/**
 * Every category the app offers. Adding next month's category should be: write its definition,
 * add it here, add a test. The form, validation, outbox and API payload are all generic.
 */
export const CATEGORIES: readonly CategoryDef[] = [excavator];

export function getCategory(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function submissionTitle(categoryId: string, fields: Record<string, unknown>): string {
  const def = getCategory(categoryId);
  const parts = (def?.titleFields ?? []).map((k) => fields[k]).filter((v) => v !== undefined && v !== '');
  return parts.length ? parts.join(' ') : def?.label ?? categoryId;
}
