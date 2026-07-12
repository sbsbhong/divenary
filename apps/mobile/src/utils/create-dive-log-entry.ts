import type { DiveLogEntry } from '../types/dive-log-entry';

type CreateBlankDiveLogEntryOptions = {
  localId?: string;
  now?: number;
};

export const createBlankDiveLogEntry = (options: CreateBlankDiveLogEntryOptions = {}): DiveLogEntry => {
  const timestamp = options.now ?? Date.now() / 1000;
  const localId = options.localId ?? createLocalDiveLogId(timestamp);

  return {
    localId,
    source: 'manual',
    cloudSyncStatus: 'notConfigured',
    createdAt: timestamp,
    updatedAt: timestamp,
    manual: {
      site: {},
      buddyIds: [],
      gearIds: [],
      tags: [],
      observedMarineLife: [],
      measuredValues: {},
    },
    mobile: {
      mediaPlaceholders: [],
    },
    provenance: {
      site: 'manual',
      buddyIds: 'manual',
      gearIds: 'manual',
      tags: 'manual',
      observedMarineLife: 'manual',
      notes: 'manual',
      rating: 'manual',
      measuredValues: 'manual',
      mediaPlaceholders: 'mobile',
    },
  };
};

const createLocalDiveLogId = (timestamp: number) => {
  return `manual:${Math.round(timestamp * 1000).toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
};
