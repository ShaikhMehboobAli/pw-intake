import { PermanentError, RetryableError } from '../errors';
import { createHttpTransport } from '../httpTransport';
import type { OutboxItem } from '../types';

const item: OutboxItem = {
  id: 'key-123',
  category: 'excavator',
  fields: { make: 'CAT' },
  photos: [{ uri: 'file:///doc/0.jpg', name: '0.jpg', type: 'image/jpeg' }],
  status: 'sending',
  attempts: 1,
  createdAt: 0,
  nextAttemptAt: 0,
};

const response = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  ({
    status,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
  }) as unknown as Response;

const transportWith = (fetchImpl: jest.Mock, timeoutMs = 1_000) =>
  createHttpTransport({ baseUrl: 'http://api', fetchImpl, timeoutMs, appendPhoto: () => {} });

describe('httpTransport', () => {
  it('posts to /submissions with the item id as Idempotency-Key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(201, { id: 'sub_1' }));
    await expect(transportWith(fetchImpl).send(item)).resolves.toEqual({ serverId: 'sub_1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/submissions');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('key-123');
  });

  it.each([500, 502, 503, 408, 429])('treats HTTP %i as retryable', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(response(status));
    await expect(transportWith(fetchImpl).send(item)).rejects.toBeInstanceOf(RetryableError);
  });

  it.each([400, 401, 413, 422])('treats HTTP %i as permanent', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(response(status));
    await expect(transportWith(fetchImpl).send(item)).rejects.toBeInstanceOf(PermanentError);
  });

  it('passes Retry-After through as a hint', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(503, {}, { 'retry-after': '20' }));
    await expect(transportWith(fetchImpl).send(item)).rejects.toMatchObject({ retryAfterMs: 20_000 });
  });

  it('turns a network failure into a retryable error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(transportWith(fetchImpl).send(item)).rejects.toThrow(/network error/);
  });

  it('aborts and retries a request that never answers', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const p = transportWith(fetchImpl as unknown as jest.Mock, 5_000).send(item);
    const assertion = expect(p).rejects.toThrow('timed out after 5s');
    await jest.advanceTimersByTimeAsync(5_000);
    await assertion;
    jest.useRealTimers();
  });

  it('retries when the response body is cut off or has no id', async () => {
    const cut = { ...response(201), json: async () => { throw new SyntaxError('Unexpected end'); } } as unknown as Response;
    await expect(transportWith(jest.fn().mockResolvedValue(cut)).send(item)).rejects.toThrow('response interrupted');
    await expect(transportWith(jest.fn().mockResolvedValue(response(201, {}))).send(item)).rejects.toThrow('malformed');
  });
});
