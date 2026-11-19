/**
 * End-to-end: real Outbox + real HTTP transport against the real mock server in "bad wifi" mode
 * (503s, hangs, connection resets, and responses dropped *after* the server saved the data).
 * Timings are scaled down so the run takes a few seconds.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHttpTransport } from '../httpTransport';
import { Outbox } from '../outbox';
import { FakePhotoStore, MemoryStore } from './fakes';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('../../../server/app');

/** Deterministic PRNG so a failing run can be reproduced. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 15;

describe.each([1, 2, 3])('on a bad connection (seed %i)', (seed) => {
  let server: Server;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;

  beforeAll(async () => {
    app = createApp({ profile: 'bad', random: mulberry32(seed), log: () => {} });
    Object.assign(app.locals.state.chaos, { latencyMs: [0, 15] });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it(`delivers all ${N} submissions exactly once`, async () => {
    let n = 0;
    const store = new MemoryStore();
    const outbox = new Outbox({
      store,
      photos: new FakePhotoStore(),
      transport: createHttpTransport({
        baseUrl,
        timeoutMs: 250,
        appendPhoto: (form, p) => form.append('photos', new Blob(['jpeg-bytes'], { type: p.type }), p.name),
      }),
      newId: () => `seed${seed}-item-${++n}`,
      backoff: { baseMs: 10, maxMs: 80 },
    });

    for (let i = 0; i < N; i++) {
      await outbox.enqueue({
        category: 'excavator',
        fields: { serial: `SN-${i}` },
        photos: [{ uri: `file:///p/${i}.jpg`, name: `${i}.jpg`, type: 'image/jpeg' }],
      });
    }

    const deadline = Date.now() + 25_000;
    while (outbox.getSnapshot().some((i) => i.status !== 'sent') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    outbox.dispose();

    const items = outbox.getSnapshot();
    const received = app.locals.state.submissions;
    const retries = items.reduce((sum, i) => sum + i.attempts - 1, 0);

    expect(items.filter((i) => i.status !== 'sent')).toEqual([]);
    // Exactly once on the server, despite drop-after-commit making the client resend.
    expect(received).toHaveLength(N);
    expect(new Set(received.map((s: { fields: { serial: string } }) => s.fields.serial)).size).toBe(N);
    expect(received.every((s: { photos: unknown[] }) => s.photos.length === 1)).toBe(true);
    // Make sure the chaos actually bit; otherwise this test proves nothing.
    expect(retries).toBeGreaterThan(0);
  }, 30_000);
});

describe('the baseline fire-and-forget approach, for contrast', () => {
  it('duplicates submissions when retried without an idempotency key', async () => {
    const app = createApp({ profile: 'good', log: () => {} });
    Object.assign(app.locals.state.chaos, { dropAfterCommitRate: 1 });
    const server: Server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/submissions`;
    const post = () => {
      const form = new FormData();
      form.append('category', 'excavator');
      return fetch(url, { method: 'POST', body: form }).catch(() => null);
    };
    await post();
    await post(); // a naive retry after "the request failed"
    expect(app.locals.state.submissions).toHaveLength(2);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
});
