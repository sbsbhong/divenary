import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { MOBILE_STORAGE_DATABASE_NAME } from './storage-keys';

/** String storage where `setString` replaces one key atomically: readers see the old or the new value. */
export type PersistentKeyValueStore = {
  getString(key: string): Promise<string | undefined>;
  setString(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export const createAsyncStorageKeyValueStore = (
  databaseName: string = MOBILE_STORAGE_DATABASE_NAME,
): PersistentKeyValueStore => {
  const storage = createAsyncStorage(databaseName);

  return {
    async getString(key: string): Promise<string | undefined> {
      const value = await storage.getItem(key);
      return value ?? undefined;
    },
    async setString(key: string, value: string): Promise<void> {
      await storage.setItem(key, value);
    },
    async remove(key: string): Promise<void> {
      await storage.removeItem(key);
    },
  };
};
