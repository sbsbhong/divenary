import type { PersistentKeyValueStore } from './persistent-key-value-store';

export const MOBILE_STORAGE_DATABASE_NAME = 'dive-app-mobile';

export const mobileStorageKeys = {
  logbook: 'dive-app:logbook:v2',
  planbook: 'dive-app:planbook:v2',
  preferences: 'dive-app:preferences:v1',
  legacyGuestMigration: 'dive-app:data:legacy-to-guest:v1',
  watchLogDeletions: 'dive-app:watch-log-deletions:v1',
  watchRejectedPayloads: 'dive-app:watch-rejected-payloads:v1',
  watchImportFailures: 'dive-app:watch-import-failures:v1',
} as const;

/** Keys earlier development builds wrote that nothing reads any more. */
const obsoleteStorageKeys = ['dive-app:debug:bootstrap-trace'] as const;

export async function removeObsoleteStorageKeys(storage: PersistentKeyValueStore): Promise<void> {
  await Promise.all(obsoleteStorageKeys.map(key => storage.remove(key).catch(() => undefined)));
}
