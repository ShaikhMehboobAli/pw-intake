import type { KeyValueStore, OutboxItem, PhotoStore, Transport } from '../types';

export class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  failWrites = false;
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('disk full');
    this.data.set(key, value);
  }
  queue(key = 'outbox.v1'): OutboxItem[] {
    return JSON.parse(this.data.get(key) ?? '[]');
  }
}

export class FakePhotoStore implements PhotoStore {
  stored = new Map<string, number>();
  removed: string[] = [];
  async persist(itemId: string, photos: { uri: string; name: string; type: string }[]) {
    this.stored.set(itemId, photos.length);
    return photos.map((p, i) => ({ ...p, uri: `file:///documents/outbox/${itemId}/${i}.jpg` }));
  }
  async remove(itemId: string) {
    this.removed.push(itemId);
    this.stored.delete(itemId);
  }
}

type Step = (item: OutboxItem) => Promise<{ serverId: string }>;

/** A transport that plays a script of outcomes, then succeeds. Records every call. */
export class ScriptedTransport implements Transport {
  calls: OutboxItem[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private n = 0;
  constructor(private script: Step[] = []) {}
  async send(item: OutboxItem) {
    this.calls.push(item);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const step = this.script.shift();
      if (step) return await step(item);
      return { serverId: `srv_${++this.n}` };
    } finally {
      this.inFlight--;
    }
  }
}

export const draft = (overrides: Partial<{ category: string; fields: Record<string, unknown> }> = {}) => ({
  category: 'excavator',
  fields: { make: 'CAT', model: '320', hours: 4200 },
  photos: [{ uri: 'file:///cache/ImagePicker/abc.jpg', name: 'abc.jpg', type: 'image/jpeg' }],
  ...overrides,
});

let seq = 0;
export const ids = () => `id-${++seq}`;
