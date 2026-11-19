type Base = { key: string; label: string; required?: boolean };

export type FieldDef =
  | (Base & { kind: 'text'; placeholder?: string })
  | (Base & { kind: 'multiline'; placeholder?: string })
  | (Base & { kind: 'number'; min?: number; max?: number; integer?: boolean; unit?: string })
  | (Base & { kind: 'select'; options: readonly string[] });

export type CategoryDef = {
  /** Sent to the API as `category`. Never rename once live: queued items reference it. */
  id: string;
  label: string;
  fields: readonly FieldDef[];
  minPhotos: number;
  maxPhotos: number;
  /** Shot list shown to the dealer; guidance only, not enforced. */
  photoChecklist?: readonly string[];
  /** Field keys used to title the submission in the outbox. */
  titleFields: readonly string[];
};

/** Raw form state: every input is a string until validated. */
export type FormValues = Record<string, string>;
