import { backoffDelay, BackoffConfig, DEFAULT_BACKOFF } from './backoff';
import { PermanentError, RetryableError } from './errors';
import type { KeyValueStore, OutboxItem, PhotoStore, SubmissionDraft, Transport } from './types';

export type OutboxDeps = {
  store: KeyValueStore;
  transport: Transport;
  photos: PhotoStore;
  newId: () => string;
  now?: () => number;
  random?: () => number;
  backoff?: BackoffConfig;
  storageKey?: string;
  /** How many successfully-sent items to keep for the dealer's history. */
  keepSent?: number;
  log?: (msg: string) => void;
};

type Listener = (items: readonly OutboxItem[]) => void;

/**
 * A durable, single-flight submission queue.
 *
 * Invariants:
 *  - An item is written to storage (with its photos copied somewhere durable) before enqueue()
 *    resolves. Only then may the UI tell the dealer it is safe.
 *  - Every attempt sends the same Idempotency-Key (item.id), so "the server saved it but we never
 *    heard back" resolves to one appraisal, not two.
 *  - Only one request is in flight at a time: on bad wifi, parallel photo uploads just compete.
 *  - Retryable failures never drop an item; they back off. Only a permanent (4xx) rejection
 *    stops retries, and that item stays visible until the dealer retries or discards it.
 */
export class Outbox {
  private items: OutboxItem[] = [];
  private snapshot: readonly OutboxItem[] = [];
  private listeners = new Set<Listener>();
  private loading: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private disposed = false;

  private readonly now: () => number;
  private readonly random: () => number;
  private readonly backoff: BackoffConfig;
  private readonly key: string;
  private readonly keepSent: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: OutboxDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.backoff = deps.backoff ?? DEFAULT_BACKOFF;
    this.key = deps.storageKey ?? 'outbox.v1';
    this.keepSent = deps.keepSent ?? 20;
    this.log = deps.log ?? (() => {});
  }

  // ---------- public API ----------

  load(): Promise<void> {
    if (!this.loading) this.loading = this.doLoad();
    return this.loading;
  }

  getSnapshot = (): readonly OutboxItem[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Resolves once the submission is durably stored on the device. Rejects if it could not be. */
  async enqueue(draft: SubmissionDraft): Promise<OutboxItem> {
    await this.load();
    const id = this.deps.newId();
    const photos = await this.deps.photos.persist(id, draft.photos);
    const item: OutboxItem = {
      ...draft,
      photos,
      id,
      status: 'pending',
      attempts: 0,
      createdAt: this.now(),
      nextAttemptAt: 0,
    };
    this.items.push(item);
    try {
      await this.persist();
    } catch (e) {
      // Not durable, so don't pretend it is: roll back and let the UI keep the form filled in.
      this.items = this.items.filter((i) => i.id !== id);
      await this.deps.photos.remove(id).catch(() => {});
      throw e;
    }
    this.emit();
    void this.kick();
    return item;
  }

  /** Call when connectivity returns or the app comes to the foreground: skip the backoff wait. */
  connectivityRestored(): Promise<void> {
    this.pausedUntil = 0;
    const t = this.now();
    this.items = this.items.map((i) => (i.status === 'pending' ? { ...i, nextAttemptAt: t } : i));
    this.emit();
    return this.kick();
  }

  /** Dealer-initiated retry, including for items the server rejected. */
  async retry(id: string): Promise<void> {
    this.pausedUntil = 0;
    this.patch(id, { status: 'pending', nextAttemptAt: this.now() }, (i) => i.status !== 'sending' && i.status !== 'sent');
    await this.persist();
    this.emit();
    return this.kick();
  }

  async discard(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item || item.status === 'sending') return;
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
    this.emit();
    await this.deps.photos.remove(id).catch(() => {});
  }

  /** Process every due item. Concurrent calls coalesce into the single running drain. */
  kick(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.clearTimer();
    this.running = (async () => {
      try {
        await this.load();
        do {
          this.rerun = false;
          await this.drain();
        } while (this.rerun);
      } finally {
        this.running = null;
        this.scheduleNext();
      }
    })();
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }

  // ---------- internals ----------

  private async doLoad(): Promise<void> {
    const raw = await this.deps.store.getItem(this.key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as OutboxItem[];
        // Anything "sending" when the app died never got an answer. The idempotency key makes it
        // safe to just send it again.
        this.items = parsed.map((i) => (i.status === 'sending' ? { ...i, status: 'pending', nextAttemptAt: 0 } : i));
      } catch {
        // Never silently destroy a dealer's work: park the unreadable blob for support.
        this.log('outbox: stored queue is corrupt; backing it up and starting empty');
        await this.deps.store.setItem(`${this.key}.corrupt.${this.now()}`, raw);
        this.items = [];
      }
    }
    this.emit();
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (this.disposed || this.pausedUntil > this.now()) return;
      const t = this.now();
      const next = this.items.find((i) => i.status === 'pending' && i.nextAttemptAt <= t);
      if (!next) return;
      await this.attempt(next.id);
    }
  }

  private async attempt(id: string): Promise<void> {
    const before = this.patch(id, (i) => ({ status: 'sending', attempts: i.attempts + 1 }));
    if (!before) return;
    await this.persist().catch(() => {});
    this.emit();

    try {
      const { serverId } = await this.deps.transport.send(before);
      this.patch(id, { status: 'sent', serverId, sentAt: this.now(), lastError: undefined });
      this.pruneSent();
      await this.persist().catch(() => {});
      this.emit();
      await this.deps.photos.remove(id).catch(() => {});
      this.log(`outbox: ${id} sent as ${serverId}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof PermanentError) {
        this.patch(id, { status: 'failed', lastError: message });
        this.log(`outbox: ${id} rejected: ${message}`);
      } else {
        const attempts = this.items.find((i) => i.id === id)?.attempts ?? 1;
        const hinted = e instanceof RetryableError ? e.retryAfterMs ?? 0 : 0;
        const delay = Math.max(hinted, backoffDelay(attempts, this.backoff, this.random));
        const nextAttemptAt = this.now() + delay;
        this.patch(id, { status: 'pending', lastError: message, nextAttemptAt });
        // The connection is probably bad for everything; don't burn a timeout on each queued item.
        this.pausedUntil = nextAttemptAt;
        this.log(`outbox: ${id} attempt ${attempts} failed (${message}); retry in ${delay}ms`);
      }
      await this.persist().catch(() => {});
      this.emit();
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (this.disposed) return;
    const pending = this.items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;
    const earliest = Math.max(this.pausedUntil, Math.min(...pending.map((i) => i.nextAttemptAt)));
    const delay = Math.max(0, earliest - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.kick();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private patch(
    id: string,
    change: Partial<OutboxItem> | ((i: OutboxItem) => Partial<OutboxItem>),
    when: (i: OutboxItem) => boolean = () => true,
  ): OutboxItem | undefined {
    let updated: OutboxItem | undefined;
    this.items = this.items.map((i) => {
      if (i.id !== id || !when(i)) return i;
      updated = { ...i, ...(typeof change === 'function' ? change(i) : change) };
      return updated;
    });
    return updated;
  }

  private pruneSent(): void {
    const sent = this.items.filter((i) => i.status === 'sent').sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
    const drop = new Set(sent.slice(this.keepSent).map((i) => i.id));
    if (drop.size) this.items = this.items.filter((i) => !drop.has(i.id));
  }

  /** Writes are serialised so an older snapshot can never land after a newer one. */
  private persist(): Promise<void> {
    const data = JSON.stringify(this.items);
    const write = this.writeChain.catch(() => {}).then(() => this.deps.store.setItem(this.key, data));
    this.writeChain = write;
    return write;
  }

  private emit(): void {
    this.snapshot = [...this.items];
    this.listeners.forEach((l) => l(this.snapshot));
  }
}
