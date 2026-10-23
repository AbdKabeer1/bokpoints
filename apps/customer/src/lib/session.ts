import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * The session's storage (Way Forward 4.4): expo-secure-store, whose web
 * build uses the browser's own storage and whose native build uses the
 * platform keystore/keychain — no more plain AsyncStorage.
 *
 * Android caps one SecureStore item at 2048 characters and a Supabase
 * session is bigger, so long values are chunked across numbered keys.
 */
const CHUNK = 1900;

async function secureSetItem(key: string, value: string): Promise<void> {
  if (value.length <= CHUNK) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const parts = Math.ceil(value.length / CHUNK);
  for (let index = 0; index < parts; index += 1) {
    await SecureStore.setItemAsync(
      `${key}.${index}`,
      value.slice(index * CHUNK, (index + 1) * CHUNK),
    );
  }
  await SecureStore.setItemAsync(`${key}.chunks`, String(parts));
}

async function secureGetItem(key: string): Promise<string | null> {
  const chunkCount = await SecureStore.getItemAsync(`${key}.chunks`);
  if (chunkCount === null) return SecureStore.getItemAsync(key);
  let value = '';
  for (let index = 0; index < Number(chunkCount); index += 1) {
    const part = await SecureStore.getItemAsync(`${key}.${index}`);
    if (part === null) return null;
    value += part;
  }
  return value;
}

async function secureRemoveItem(key: string): Promise<void> {
  const chunkCount = await SecureStore.getItemAsync(`${key}.chunks`);
  if (chunkCount !== null) {
    for (let index = 0; index < Number(chunkCount); index += 1) {
      await SecureStore.deleteItemAsync(`${key}.${index}`);
    }
    await SecureStore.deleteItemAsync(`${key}.chunks`);
  }
  await SecureStore.deleteItemAsync(key);
}

export const secureStorage = {
  getItem: secureGetItem,
  setItem: secureSetItem,
  removeItem: secureRemoveItem,
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/**
 * True when the build was given its Supabase settings. Without them the app
 * shows a setup message instead of failing at the first sign-in.
 */
export const hasConfig = url !== '' && publishableKey !== '';

export const supabase = createClient(url || 'http://127.0.0.1:54321', publishableKey || 'missing', {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    // On the web a magic link can land back in the same tab; on a phone the
    // app asks for the 6-digit code instead.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/** Sends a one-time code (FR-AUTH-1). Creates the account on first use. */
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (!error) return;
  // The server could not be told, but a shared browser must still forget the
  // previous customer's session rather than restore it on the next load.
  await supabase.auth.signOut({ scope: 'local' });
}

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function onAuthChange(handler: () => void): () => void {
  const { data } = supabase.auth.onAuthStateChange(() => handler());
  return () => data.subscription.unsubscribe();
}
