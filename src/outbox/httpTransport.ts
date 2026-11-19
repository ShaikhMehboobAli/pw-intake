import { classifyHttpStatus, RetryableError } from './errors';
import type { LocalPhoto, OutboxItem, Transport } from './types';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpTransportOptions = {
  baseUrl: string;
  /** Whole-request timeout. Photo uploads on dealership wifi are slow, so this is generous. */
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** How a photo becomes a multipart part. React Native takes { uri, name, type }; tests use Blobs. */
  appendPhoto?: (form: FormData, photo: LocalPhoto) => void | Promise<void>;
};

const reactNativeAppendPhoto = (form: FormData, photo: LocalPhoto) => {
  // React Native's FormData streams the file from disk when given this shape.
  form.append('photos', { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
};

export function createHttpTransport({
  baseUrl,
  timeoutMs = 60_000,
  fetchImpl = (url, init) => fetch(url, init),
  appendPhoto = reactNativeAppendPhoto,
}: HttpTransportOptions): Transport {
  return {
    async send(item: OutboxItem) {
      const form = new FormData();
      form.append('category', item.category);
      form.append('fields', JSON.stringify(item.fields));
      for (const photo of item.photos) await appendPhoto(form, photo);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let res: Response;
        try {
          res = await fetchImpl(`${baseUrl}/submissions`, {
            method: 'POST',
            body: form,
            headers: { 'Idempotency-Key': item.id },
            signal: controller.signal,
          });
        } catch (e) {
          throw new RetryableError(
            controller.signal.aborted ? `timed out after ${Math.round(timeoutMs / 1000)}s` : `network error: ${(e as Error).message}`,
          );
        }

        const statusError = classifyHttpStatus(res.status, res.headers.get('retry-after'));
        if (statusError) throw statusError;

        let body: { id?: string };
        try {
          body = await res.json();
        } catch {
          // Connection died mid-response. The server may have saved it; the idempotency key covers that.
          throw new RetryableError('response interrupted');
        }
        if (!body?.id) throw new RetryableError('malformed response');
        return { serverId: body.id };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
