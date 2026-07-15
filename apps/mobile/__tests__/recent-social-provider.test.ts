import {
  createRecentSocialProviderStore,
  type RecentSocialProvider,
} from '../src/auth/recent-social-provider';
import type {PersistentKeyValueStore} from '../src/storage/persistent-key-value-store';

const storageKey = 'dive-app:auth:recent-social-provider:v1';

function createStorage(initialValue?: string) {
  const values = new Map<string, string>();

  if (initialValue !== undefined) {
    values.set(storageKey, initialValue);
  }

  const storage: PersistentKeyValueStore = {
    getString: jest.fn(async key => values.get(key)),
    setString: jest.fn(async (key, value) => {
      values.set(key, value);
    }),
    remove: jest.fn(async key => {
      values.delete(key);
    }),
  };

  return {storage, values};
}

describe('recent social provider preference', () => {
  test.each<RecentSocialProvider>(['google', 'apple'])(
    'stores only a version and the %s provider',
    async provider => {
      const {storage, values} = createStorage();
      const store = createRecentSocialProviderStore({storage});

      await store.save(provider);

      expect(storage.setString).toHaveBeenCalledWith(
        storageKey,
        JSON.stringify({schemaVersion: 1, provider}),
      );
      expect(JSON.parse(values.get(storageKey) ?? '{}')).toEqual({
        schemaVersion: 1,
        provider,
      });
    },
  );

  test.each([
    undefined,
    'not-json',
    JSON.stringify(null),
    JSON.stringify({schemaVersion: 2, provider: 'google'}),
    JSON.stringify({schemaVersion: 1, provider: 'github'}),
    JSON.stringify({schemaVersion: 1, provider: 'google', token: 'secret'}),
  ])('ignores absent, malformed, unknown, or expanded values %#', async raw => {
    const {storage} = createStorage(raw);
    const store = createRecentSocialProviderStore({storage});

    await expect(store.load()).resolves.toBeUndefined();
  });

  test('loads a strict known envelope without exposing other data', async () => {
    const {storage} = createStorage(
      JSON.stringify({schemaVersion: 1, provider: 'apple'}),
    );
    const store = createRecentSocialProviderStore({storage});

    await expect(store.load()).resolves.toBe('apple');
  });
});
