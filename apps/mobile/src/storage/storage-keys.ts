export const MOBILE_STORAGE_DATABASE_NAME = 'dive-app-mobile';

export const mobileStorageKeys = {
  logbook: 'dive-app:logbook:v2',
  planbook: 'dive-app:planbook:v2',
  preferences: 'dive-app:preferences:v1',
  legacyGuestMigration: 'dive-app:data:legacy-to-guest:v1',
  watchLogDeletions: 'dive-app:watch-log-deletions:v1',
} as const;
