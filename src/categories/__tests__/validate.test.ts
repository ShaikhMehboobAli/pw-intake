import { CATEGORIES, PHOTOS_KEY, submissionTitle, validate } from '..';
import { excavator } from '../excavator';
import type { CategoryDef } from '../types';

const valid = { make: 'CAT', model: '320', hours: '4,200', condition: 'Good' };

describe('validate', () => {
  it('parses a valid excavator into typed fields', () => {
    const r = validate(excavator, { ...valid, year: '2018', notes: '  minor leak ' }, 2);
    expect(r).toEqual({
      ok: true,
      errors: {},
      fields: { make: 'CAT', model: '320', hours: 4200, condition: 'Good', year: 2018, notes: 'minor leak' },
    });
  });

  it('reports every missing required field and the photo minimum', () => {
    const r = validate(excavator, {}, 0);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['_photos', 'condition', 'hours', 'make', 'model'].sort());
  });

  it.each([
    ['abc', 'must be a number'],
    ['12.5', 'whole number'],
    ['-1', 'at least 0'],
    ['999999', 'at most'],
  ])('rejects hours = %p', (hours, message) => {
    const r = validate(excavator, { ...valid, hours }, 1);
    expect(r.errors.hours).toContain(message);
  });

  it('only accepts listed options for a select', () => {
    expect(validate(excavator, { ...valid, condition: 'Mint' }, 1).errors.condition).toBeDefined();
  });

  it('enforces the photo maximum', () => {
    expect(validate(excavator, valid, 21).errors[PHOTOS_KEY]).toContain('No more than 20');
  });

  it('works for a category it has never seen (stand-in for next month’s)', () => {
    const forklift: CategoryDef = {
      id: 'forklift',
      label: 'Forklift',
      fields: [
        { key: 'capacity', label: 'Lift capacity', kind: 'number', required: true, min: 500 },
        { key: 'fuel', label: 'Fuel', kind: 'select', options: ['Electric', 'LPG', 'Diesel'], required: true },
      ],
      minPhotos: 0,
      maxPhotos: 10,
      titleFields: ['fuel'],
    };
    expect(validate(forklift, { capacity: '3000', fuel: 'LPG' }, 0)).toMatchObject({ ok: true, fields: { capacity: 3000, fuel: 'LPG' } });
  });
});

describe('category registry', () => {
  it('has unique ids, and every titleField is a real field', () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATEGORIES) {
      const keys = new Set(c.fields.map((f) => f.key));
      expect(new Set(c.fields.map((f) => f.key)).size).toBe(c.fields.length);
      c.titleFields.forEach((k) => expect(keys).toContain(k));
      expect(c.minPhotos).toBeLessThanOrEqual(c.maxPhotos);
    }
  });

  it('titles submissions from config, falling back to the category label', () => {
    expect(submissionTitle('excavator', { make: 'CAT', model: '320' })).toBe('CAT 320');
    expect(submissionTitle('excavator', {})).toBe('Excavator');
    expect(submissionTitle('retired-category', {})).toBe('retired-category');
  });
});
