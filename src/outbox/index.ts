import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';
import { API_URL } from '../config';
import { fileSystemPhotoStore } from './fileSystemPhotoStore';
import { createHttpTransport } from './httpTransport';
import { Outbox } from './outbox';

export { Outbox } from './outbox';
export type { OutboxItem, OutboxStatus, LocalPhoto, SubmissionDraft } from './types';

export const outbox = new Outbox({
  store: AsyncStorage,
  photos: fileSystemPhotoStore,
  transport: createHttpTransport({ baseUrl: API_URL }),
  newId: randomUUID,
  log: __DEV__ ? console.log : undefined,
});

let started = false;

/**
 * Wire the outbox to the device: resume on launch, when the network comes back, and when the app
 * returns to the foreground. Expo Go cannot run true background uploads, so these are our triggers.
 */
export function startOutbox(): () => void {
  if (started) return () => {};
  started = true;
  void outbox.load().then(() => outbox.kick());

  let wasOnline: boolean | null = null;
  const unsubscribeNet = NetInfo.addEventListener((state) => {
    const online = state.isConnected === true && state.isInternetReachable !== false;
    if (online && wasOnline === false) void outbox.connectivityRestored();
    wasOnline = online;
  });
  const appStateSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void outbox.connectivityRestored();
  });

  return () => {
    started = false;
    unsubscribeNet();
    appStateSub.remove();
  };
}
