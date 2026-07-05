import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiClient } from '@myfinance/shared';
import Constants from 'expo-constants';

const TOKEN_KEY = 'myfinance.token';

export function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized: (() => void) | undefined;
export function setOnUnauthorized(handler: () => void) {
  onUnauthorized = handler;
}

export const baseUrl: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000';

export const api = new ApiClient({
  baseUrl,
  getToken,
  onUnauthorized: () => onUnauthorized?.(),
});
