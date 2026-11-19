import type { CategoryDef } from './types';

const CURRENT_YEAR = new Date().getFullYear();

export const excavator: CategoryDef = {
  id: 'excavator',
  label: 'Excavator',
  fields: [
    { key: 'make', label: 'Make', kind: 'text', required: true, placeholder: 'e.g. Caterpillar' },
    { key: 'model', label: 'Model', kind: 'text', required: true, placeholder: 'e.g. 320' },
    { key: 'year', label: 'Year', kind: 'number', integer: true, min: 1950, max: CURRENT_YEAR + 1 },
    { key: 'hours', label: 'Hours', kind: 'number', required: true, integer: true, min: 0, max: 200_000, unit: 'hrs' },
    { key: 'serial', label: 'Serial / PIN', kind: 'text' },
    { key: 'condition', label: 'Overall condition', kind: 'select', required: true, options: ['Excellent', 'Good', 'Fair', 'Poor'] },
    { key: 'notes', label: 'Condition notes', kind: 'multiline', placeholder: 'Leaks, damage, recent repairs…' },
  ],
  minPhotos: 1,
  maxPhotos: 20,
  photoChecklist: ['Front', 'Rear', 'Both sides', 'Cab interior', 'Hour meter', 'Undercarriage / tracks'],
  titleFields: ['make', 'model'],
};
