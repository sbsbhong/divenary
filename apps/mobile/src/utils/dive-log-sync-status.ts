import type { DiveLogSyncStatus } from '../types/dive-log-entry';
import type { MobileDiveSession } from '../types/dive-session';

export type VisibleCloudSyncStatus = 'localOnly' | NonNullable<MobileDiveSession['syncStatus']>;

export const toVisibleCloudSyncStatus = (syncStatus: DiveLogSyncStatus): VisibleCloudSyncStatus => {
  if (syncStatus === 'localOnly') {
    return 'localOnly';
  }

  return 'pending';
};

export const toMobileSessionSyncStatus = (syncStatus: DiveLogSyncStatus): MobileDiveSession['syncStatus'] => {
  if (syncStatus === 'localOnly') {
    return undefined;
  }

  return 'pending';
};

export const toVisibleRecentSessionSyncStatus = (
  _syncStatus: MobileDiveSession['syncStatus'] | undefined,
): NonNullable<MobileDiveSession['syncStatus']> => {
  return 'pending';
};
