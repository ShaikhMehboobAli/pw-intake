import { useSyncExternalStore } from 'react';
import type { Outbox } from './outbox';
import type { OutboxItem } from './types';

export function useOutboxItems(outbox: Outbox): readonly OutboxItem[] {
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);
}
