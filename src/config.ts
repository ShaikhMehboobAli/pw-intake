import Constants from 'expo-constants';

// In Expo Go the bundle is served from the dev machine, so the mock server is reachable on the
// same host. EXPO_PUBLIC_API_URL overrides this (e.g. Android emulator: http://10.0.2.2:4000).
function resolveApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri ? hostUri.split(':')[0] : 'localhost';
  return `http://${host}:4000`;
}

export const API_URL = resolveApiUrl();
