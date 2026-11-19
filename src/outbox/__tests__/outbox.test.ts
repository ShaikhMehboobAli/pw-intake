import { PermanentError, RetryableError } from '../errors';
import { Outbox, OutboxDeps } from '../outbox';
import { draft, FakePhotoStore, ids, MemoryStore, ScriptedTransport } from './fakes';

const BACKOFF = { baseMs: 1_000, maxMs: 60_000 };
const retryable = (msg = 'network error') => async () => {
  throw new RetryableError(msg);
};

function setup(script: ConstructorParameters<typeof ScriptedTransport>[0] = [], overrides: Partial<OutboxDeps> = {}) {
  const store = new MemoryStore();
  const photos = new FakePhotoStore();
  const transport = new ScriptedTransport(script);
  const outbox = new Outbox({ store, photos, transport, newId: ids, backoff: BACKOFF, random: () => 0, ...overrides });
  return { store, photos, transport, outbox };
}

/** Let queued promises and any due timers run. */
const flush = async (ms = 0) => {
  await jest.advanceTimersByTimeAsync(ms);
};

beforeEach(() => jest.useFakeTimers({ now: 1_700_000_000_000 }));
afterEach(() => jest.useRealTimers());

describe('Outbox', () => {
  it('writes the item and moves its photos to durable storage before enqueue resolves', async () => {
    const { outbox, store, photos } = setup([() => new Promise(() => {})]); // never answers
    const item = await outbox.enqueue(draft());

    const saved = store.queue();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(item.id);
    expect(saved[0].photos[0].uri).toContain('/documents/outbox/');
    expect(photos.stored.get(item.id)).toBe(1);
    outbox.dispose();
  });

  it('sends, marks the item sent and cleans up its photos', async () => {
    const { outbox, store, photos } = setup();
    const item = await outbox.enqueue(draft());
    await flush();

    expect(store.queue()[0]).toMatchObject({ id: item.id, status: 'sent', serverId: 'srv_1', attempts: 1 });
    expect(photos.removed).toContain(item.id);
  });

  it('keeps retrying with backoff after transient failures, reusing the same idempotency key', async () => {
    const { outbox, transport, store } = setup([retryable(), retryable('timed out'), retryable()]);
    const item = await outbox.enqueue(draft());
    await flush();
    expect(store.queue()[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'network error' });

    // random()=0 with equal jitter => delays of 500, 1000, 2000ms
    await flush(499);
    expect(transport.calls).toHaveLength(1);
    await flush(1);
    expect(transport.calls).toHaveLength(2);
    await flush(1_000);
    await flush(2_000);

    expect(transport.calls).toHaveLength(4);
    expect(new Set(transport.calls.map((c) => c.id))).toEqual(new Set([item.id]));
    expect(store.queue()[0]).toMatchObject({ status: 'sent', attempts: 4 });
    outbox.dispose();
  });

  it('honours a server Retry-After hint when it is longer than the backoff', async () => {
    const { outbox, transport } = setup([
      async () => {
        throw new RetryableError('HTTP 503', 30_000);
      },
    ]);
    await outbox.enqueue(draft());
    await flush(29_999);
    expect(transport.calls).toHaveLength(1);
    await flush(1);
    expect(transport.calls).toHaveLength(2);
    outbox.dispose();
  });

  it('stops retrying on a permanent rejection but keeps the item for the dealer', async () => {
    const { outbox, transport, store } = setup([
      async () => {
        throw new PermanentError('HTTP 400', 400);
      },
    ]);
    const item = await outbox.enqueue(draft());
    await flush(10 * 60_000);
    expect(transport.calls).toHaveLength(1);
    expect(store.queue()[0]).toMatchObject({ status: 'failed', lastError: 'HTTP 400' });

    await outbox.retry(item.id);
    await flush();
    expect(store.queue()[0]).toMatchObject({ status: 'sent' });
  });

  it('pauses the whole queue after a network failure instead of burning a timeout per item', async () => {
    const { outbox, transport } = setup([retryable(), retryable(), retryable()]);
    await outbox.enqueue(draft());
    await outbox.enqueue(draft());
    await outbox.enqueue(draft());
    await flush();
    expect(transport.calls).toHaveLength(1);
    outbox.dispose();
  });

  it('skips the backoff wait when connectivity is restored', async () => {
    const { outbox, transport, store } = setup([retryable(), retryable()]);
    await outbox.enqueue(draft());
    await flush();
    await flush(500); // second attempt fails, now waiting ~1000ms
    expect(transport.calls).toHaveLength(2);

    await outbox.connectivityRestored();
    expect(transport.calls).toHaveLength(3);
    expect(store.queue()[0].status).toBe('sent');
  });

  it('sends queued items one at a time, oldest first', async () => {
    const { outbox, transport } = setup();
    const a = await outbox.enqueue(draft({ fields: { n: 1 } }));
    const b = await outbox.enqueue(draft({ fields: { n: 2 } }));
    const c = await outbox.enqueue(draft({ fields: { n: 3 } }));
    void outbox.kick();
    void outbox.kick();
    await flush();
    expect(transport.maxInFlight).toBe(1);
    expect(transport.calls.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it('resumes after the app is killed mid-send (the "sending" item is resent with the same key)', async () => {
    const first = setup([() => new Promise(() => {})]);
    const item = await first.outbox.enqueue(draft());
    await flush();
    expect(first.store.queue()[0].status).toBe('sending');
    first.outbox.dispose(); // app killed

    const transport = new ScriptedTransport();
    const second = new Outbox({ store: first.store, photos: first.photos, transport, newId: ids, backoff: BACKOFF });
    await second.load();
    expect(second.getSnapshot()[0].status).toBe('pending');
    await second.kick();
    expect(transport.calls[0].id).toBe(item.id);
    expect(first.store.queue()[0].status).toBe('sent');
  });

  it('rejects enqueue and keeps nothing half-saved if the device cannot store it', async () => {
    const { outbox, store, photos, transport } = setup();
    await outbox.load();
    store.failWrites = true;
    await expect(outbox.enqueue(draft())).rejects.toThrow('disk full');
    expect(photos.stored.size).toBe(0);

    // The rolled-back item must not resurface later (e.g. sent behind the dealer's back, or
    // shown alongside the one they re-submit).
    store.failWrites = false;
    await outbox.kick();
    expect(transport.calls).toHaveLength(0);
    await outbox.enqueue(draft());
    expect(outbox.getSnapshot()).toHaveLength(1);
  });

  it('backs up a corrupt stored queue instead of silently discarding it', async () => {
    const { outbox, store } = setup();
    store.data.set('outbox.v1', '{not json');
    await outbox.load();
    expect(outbox.getSnapshot()).toEqual([]);
    const backups = [...store.data.keys()].filter((k) => k.startsWith('outbox.v1.corrupt.'));
    expect(backups).toHaveLength(1);
    expect(store.data.get(backups[0])).toBe('{not json');
  });

  it('only keeps the most recent sent items for history', async () => {
    const { outbox } = setup([], { keepSent: 2 });
    for (let i = 0; i < 4; i++) {
      await outbox.enqueue(draft());
      await flush(1);
    }
    expect(outbox.getSnapshot().filter((i) => i.status === 'sent')).toHaveLength(2);
  });

  it('discards an item and its photos, but not while it is in flight', async () => {
    const { outbox, photos } = setup([() => new Promise(() => {}), retryable()]);
    const inFlight = await outbox.enqueue(draft());
    await flush();
    await outbox.discard(inFlight.id);
    expect(outbox.getSnapshot()).toHaveLength(1);

    outbox.dispose();
    const other = setup([async () => { throw new PermanentError('HTTP 422', 422); }]);
    const item = await other.outbox.enqueue(draft());
    await flush();
    await other.outbox.discard(item.id);
    expect(other.outbox.getSnapshot()).toHaveLength(0);
    expect(other.photos.removed).toContain(item.id);
    expect(photos.removed).not.toContain(inFlight.id);
  });

  it('notifies subscribers as status changes', async () => {
    const { outbox } = setup();
    const seen: string[] = [];
    outbox.subscribe((items) => items[0] && seen.push(items[0].status));
    await outbox.enqueue(draft());
    await flush();
    expect(seen).toEqual(expect.arrayContaining(['pending', 'sending', 'sent']));
  });
});
