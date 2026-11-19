export type OutboxStatus =
  | 'pending' // saved on device, waiting to (re)try
  | 'sending' // request in flight
  | 'sent' // server confirmed receipt
  | 'failed'; // server rejected it permanently (4xx) — needs the dealer's attention

export type LocalPhoto = {
  /** file:// URI inside the app's document directory (survives restarts, unlike picker cache). */
  uri: string;
  name: string;
  type: string;
};

export type SubmissionDraft = {
  category: string;
  fields: Record<string, unknown>;
  photos: LocalPhoto[];
};

export type OutboxItem = SubmissionDraft & {
  /** Client-generated UUID. Doubles as the Idempotency-Key, so retries never duplicate. */
  id: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: number;
  /** Epoch ms before which we should not retry. */
  nextAttemptAt: number;
  lastError?: string;
  serverId?: string;
  sentAt?: number;
};

/** Minimal async key-value interface; AsyncStorage satisfies it. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Moves picked photos somewhere durable, and cleans them up after a successful send. */
export interface PhotoStore {
  persist(itemId: string, photos: LocalPhoto[]): Promise<LocalPhoto[]>;
  remove(itemId: string): Promise<void>;
}

export interface Transport {
  send(item: OutboxItem): Promise<{ serverId: string }>;
}
