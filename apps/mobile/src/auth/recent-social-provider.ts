import {
  createAsyncStorageKeyValueStore,
  type PersistentKeyValueStore,
} from '../storage/persistent-key-value-store';
import type {SocialProvider} from './native-social-auth';

export type RecentSocialProvider = SocialProvider;

export type RecentSocialProviderStore = {
  load(): Promise<RecentSocialProvider | undefined>;
  save(provider: RecentSocialProvider): Promise<void>;
};

export type RecentSocialProviderStoreOptions = {
  storage?: PersistentKeyValueStore;
};

const storageKey = 'dive-app:auth:recent-social-provider:v1';

export const createRecentSocialProviderStore = (
  options: RecentSocialProviderStoreOptions = {},
): RecentSocialProviderStore => {
  const storage = options.storage ?? createAsyncStorageKeyValueStore();

  return {
    async load() {
      const rawValue = await storage.getString(storageKey);

      if (rawValue === undefined) {
        return undefined;
      }

      try {
        return parseRecentSocialProvider(JSON.parse(rawValue));
      } catch {
        return undefined;
      }
    },

    async save(provider) {
      await storage.setString(
        storageKey,
        JSON.stringify({schemaVersion: 1, provider}),
      );
    },
  };
};

export const defaultRecentSocialProviderStore =
  createRecentSocialProviderStore();

function parseRecentSocialProvider(
  value: unknown,
): RecentSocialProvider | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const keys = Object.keys(value);

  if (
    keys.length !== 2 ||
    !Object.hasOwn(value, 'schemaVersion') ||
    !Object.hasOwn(value, 'provider') ||
    Reflect.get(value, 'schemaVersion') !== 1
  ) {
    return undefined;
  }

  const provider = Reflect.get(value, 'provider');
  return provider === 'google' || provider === 'apple' ? provider : undefined;
}
