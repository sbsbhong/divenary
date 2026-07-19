import {
  composeAccountAndDeferredGuestRows,
  createPrincipalRepositories,
} from '../src/repositories/principal-repositories';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { WatchProfileStorage } from '../src/storage/watch-profile-storage';
import type { DiveLogEntry } from '../src/types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../src/types/dive-session';
import type { DivePlan } from '../src/types/dive-plan';

const logEntry = (localId: string, ownerUserId?: string): DiveLogEntry => ({
  localId,
  ownerUserId,
  source: 'manual',
  cloudSyncStatus: 'notConfigured',
  createdAt: 100,
  updatedAt: 100,
  manual: {
    site: {},
    buddyIds: [],
    gearIds: [],
    tags: [],
    observedMarineLife: [],
    measuredValues: {},
  },
  mobile: { mediaPlaceholders: [] },
  provenance: {},
});

const plan = (localId: string, ownerUserId?: string): DivePlan => ({
  localId,
  ownerUserId,
  cloudSyncStatus: 'notConfigured',
  status: 'draft',
  createdAt: 100,
  updatedAt: 100,
  site: {},
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
});

const watchMessage: WatchSyncMessage = {
  type: 'sessionEnded',
  session: {
    localSessionId: 'shared-session',
    schemaVersion: 1,
    syncStatus: 'pending',
    startedAt: 200,
    endedAt: 260,
    samples: [{ localSessionId: 'shared-session', timestamp: 200, depthMeters: 5 }],
  },
};

class RecordingProfileStorage implements WatchProfileStorage {
  readonly values = new Map<string, WatchDepthSample[]>();

  async write(key: string, samples: WatchDepthSample[]): Promise<void> {
    this.values.set(key, samples.map(sample => ({ ...sample })));
  }

  async read(key: string): Promise<WatchDepthSample[] | undefined> {
    return this.values.get(key)?.map(sample => ({ ...sample }));
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe('principal repositories', () => {
  it('defaults every missing principal partition to empty and isolates saved rows', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const dependencies = { metadataStorage, profileStorage, now: () => 500 };
    const guest = createPrincipalRepositories({ kind: 'guest' }, dependencies);
    const account = createPrincipalRepositories({ kind: 'user', userId: 'user/one' }, dependencies);

    expect(guest.queryScope).toBe('guest');
    expect(account.queryScope).toBe('user:user/one');
    await expect(guest.logbook.list()).resolves.toEqual([]);
    await expect(guest.planbook.list()).resolves.toEqual([]);
    await expect(account.logbook.list()).resolves.toEqual([]);
    await expect(account.planbook.list()).resolves.toEqual([]);

    await guest.logbook.save(logEntry('guest-log'));
    await guest.planbook.save(plan('guest-plan'));
    await account.logbook.save(logEntry('account-log', 'user/one'));
    await account.planbook.save(plan('account-plan', 'user/one'));

    expect((await guest.logbook.list()).map(row => row.localId)).toEqual(['guest-log']);
    expect((await account.logbook.list()).map(row => row.localId)).toEqual(['account-log']);
    expect((await guest.planbook.list()).map(row => row.localId)).toEqual(['guest-plan']);
    expect((await account.planbook.list()).map(row => row.localId)).toEqual(['account-plan']);
  });

  it('uses principal-specific profile prefixes for watch imports', async () => {
    const metadataStorage = new InMemoryKeyValueStore();
    const profileStorage = new RecordingProfileStorage();
    const dependencies = { metadataStorage, profileStorage, now: () => 500 };

    await createPrincipalRepositories({ kind: 'guest' }, dependencies).logbook.importWatchMessages([watchMessage]);
    await createPrincipalRepositories({ kind: 'user', userId: 'user/one' }, dependencies).logbook.importWatchMessages([watchMessage]);

    expect(Array.from(profileStorage.values.keys()).sort()).toEqual([
      'dive-mobile:watch-profile:guest:shared-session:260',
      'dive-mobile:watch-profile:user%3Auser%2Fone:shared-session:260',
    ]);
  });

  it('composes account rows first and appends only non-duplicate guest rows without ownership', () => {
    const accountRows = [logEntry('same', 'account-user'), logEntry('account-only', 'account-user')];
    const guestRows = [logEntry('guest-only', 'must-be-cleared'), logEntry('same', 'must-be-cleared')];

    const result = composeAccountAndDeferredGuestRows(accountRows, guestRows);

    expect(result.map(row => row.localId)).toEqual(['same', 'account-only', 'guest-only']);
    expect(result[0]).toBe(accountRows[0]);
    expect(result[2]).not.toBe(guestRows[0]);
    expect(result[2].ownerUserId).toBeUndefined();
    expect(guestRows[0].ownerUserId).toBe('must-be-cleared');
  });
});
