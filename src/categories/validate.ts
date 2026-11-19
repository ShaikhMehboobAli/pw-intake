import type { CategoryDef, FormValues } from './types';

export type ValidationResult =
  | { ok: true; fields: Record<string, string | number>; errors: Record<string, string> }
  | { ok: false; errors: Record<string, string> };

export const PHOTOS_KEY = '_photos';

/** Turns raw form strings into typed API fields, or per-field error messages. */
export function validate(category: CategoryDef, values: FormValues, photoCount: number): ValidationResult {
  const errors: Record<string, string> = {};
  const fields: Record<string, string | number> = {};

  for (const def of category.fields) {
    const raw = (values[def.key] ?? '').trim();
    if (!raw) {
      if (def.required) errors[def.key] = `${def.label} is required`;
      continue;
    }
    switch (def.kind) {
      case 'number': {
        const n = Number(raw.replace(/,/g, ''));
        if (!Number.isFinite(n)) errors[def.key] = `${def.label} must be a number`;
        else if (def.integer && !Number.isInteger(n)) errors[def.key] = `${def.label} must be a whole number`;
        else if (def.min !== undefined && n < def.min) errors[def.key] = `${def.label} must be at least ${def.min}`;
        else if (def.max !== undefined && n > def.max) errors[def.key] = `${def.label} must be at most ${def.max}`;
        else fields[def.key] = n;
        break;
      }
      case 'select':
        if (!def.options.includes(raw)) errors[def.key] = `Choose a ${def.label.toLowerCase()}`;
        else fields[def.key] = raw;
        break;
      default:
        fields[def.key] = raw;
    }
  }

  if (photoCount < category.minPhotos) {
    errors[PHOTOS_KEY] = `Add at least ${category.minPhotos} photo${category.minPhotos === 1 ? '' : 's'}`;
  } else if (photoCount > category.maxPhotos) {
    errors[PHOTOS_KEY] = `No more than ${category.maxPhotos} photos`;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, fields, errors: {} };
}
