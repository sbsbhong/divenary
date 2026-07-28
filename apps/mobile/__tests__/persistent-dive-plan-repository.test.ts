import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import {
  migrateDivePlanbookEnvelope,
  PersistentDivePlanRepository,
} from '../src/repositories/persistent-dive-plan-repository';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type { PersistentKeyValueStore } from '../src/storage/persistent-key-value-store';
import {PersistentJsonReadError} from '../src/storage/persistent-json-store';
import { mobileStorageKeys } from '../src/storage/storage-keys';
import type { DivePlan } from '../src/types/dive-plan';

const plan = (overrides: Partial<DivePlan>): DivePlan => ({
  localId: 'plan-base',
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
  ...overrides,
});

class FailFirstWriteStore implements PersistentKeyValueStore {
  private readonly delegate = new InMemoryKeyValueStore();
  private shouldFail = true;

  getString(key: string): Promise<string | undefined> {
    return this.delegate.getString(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('simulated plan write failure');
    }
    await this.delegate.setString(key, value);
  }

  remove(key: string): Promise<void> {
    return this.delegate.remove(key);
  }
}

class CountingMainEnvelopeStore implements PersistentKeyValueStore {
  private readonly delegate = new InMemoryKeyValueStore();
  mainReads = 0;
  mainWrites = 0;

  constructor(private readonly mainKey: string) {}

  async getString(key: string): Promise<string | undefined> {
    if (key === this.mainKey) {
      this.mainReads += 1;
    }
    return this.delegate.getString(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (key === this.mainKey) {
      this.mainWrites += 1;
    }
    await this.delegate.setString(key, value);
  }

  remove(key: string): Promise<void> {
    return this.delegate.remove(key);
  }

  resetCounts(): void {
    this.mainReads = 0;
    this.mainWrites = 0;
  }
}

class PausedWriteStore implements PersistentKeyValueStore {
  private readonly delegate = new InMemoryKeyValueStore();
  private shouldPause = false;
  private resolveWriteStarted = () => {};
  private resolveWrite = () => {};
  writeStarted = Promise.resolve();

  getString(key: string): Promise<string | undefined> {
    return this.delegate.getString(key);
  }

  async setString(key: string, value: string): Promise<void> {
    if (this.shouldPause) {
      this.shouldPause = false;
      this.resolveWriteStarted();
      await new Promise<void>(resolve => {
        this.resolveWrite = resolve;
      });
    }
    await this.delegate.setString(key, value);
  }

  remove(key: string): Promise<void> {
    return this.delegate.remove(key);
  }

  pauseNextWrite(): void {
    this.shouldPause = true;
    this.writeStarted = new Promise<void>(resolve => {
      this.resolveWriteStarted = resolve;
    });
  }

  releaseWrite(): void {
    this.resolveWrite();
  }
}

describe('PersistentDivePlanRepository', () => {
  it('does not replace unreadable local planbook bytes when a save follows', async () => {
    const storage = new InMemoryKeyValueStore();
    const raw = '{"schemaVersion":99,"updatedAt":1,"value":[]}';
    await storage.setString('principal-planbook', raw);
    const repository = new PersistentDivePlanRepository({
      storage,
      storageKey: 'principal-planbook',
    });

    await expect(repository.save(plan({}))).rejects.toBeInstanceOf(
      PersistentJsonReadError,
    );
    await expect(storage.getString('principal-planbook')).resolves.toBe(raw);
  });

  it('persists account revision and conflict state in the current schema', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDivePlanRepository({storage, now: () => 500});
    await repository.save({
      ...plan({}),
      remoteId: '10000000-0000-4000-8000-000000000001',
      remoteRevision: 3,
      ownerUserId: '00000000-0000-4000-8000-000000000001',
      cloudSyncStatus: 'conflict',
    });

    await expect(
      new PersistentDivePlanRepository({storage, now: () => 500}).get('plan-base'),
    ).resolves.toMatchObject({remoteRevision: 3, cloudSyncStatus: 'conflict'});
  });

  it('migrates schema-2 plans to guest cloud metadata without fabricating ownership', async () => {
    const storage = new InMemoryKeyValueStore();
    const legacyPlan = plan({ localId: 'legacy-plan' });
    delete legacyPlan.cloudSyncStatus;
    await storage.setString(
      mobileStorageKeys.planbook,
      JSON.stringify({ schemaVersion: 2, updatedAt: 300, value: [legacyPlan] }),
    );

    const [migrated] = await new PersistentDivePlanRepository({ storage, now: () => 350 }).list();

    expect(migrated.cloudSyncStatus).toBe('notConfigured');
    expect(migrated.ownerUserId).toBeUndefined();
    expect(migrated.remoteId).toBeUndefined();
  });

  it('serializes concurrent read-modify-write saves', async () => {
    const repository = new PersistentDivePlanRepository({ storage: new InMemoryKeyValueStore(), now: () => 350 });

    await Promise.all([
      repository.save(plan({ localId: 'concurrent-a' })),
      repository.save(plan({ localId: 'concurrent-b' })),
    ]);

    expect((await repository.list()).map(currentPlan => currentPlan.localId).sort()).toEqual([
      'concurrent-a',
      'concurrent-b',
    ]);
  });

  it('continues the mutation queue after one operation rejects', async () => {
    const repository = new PersistentDivePlanRepository({ storage: new FailFirstWriteStore(), now: () => 350 });

    await expect(repository.save(plan({ localId: 'rejected' }))).rejects.toThrow('simulated plan write failure');
    await expect(repository.save(plan({ localId: 'accepted' }))).resolves.toMatchObject({ localId: 'accepted' });

    expect((await repository.list()).map(currentPlan => currentPlan.localId)).toEqual(['accepted']);
  });

  it('conditionally deletes many plans with one metadata read and write', async () => {
    const storage = new CountingMainEnvelopeStore(mobileStorageKeys.planbook);
    const repository = new PersistentDivePlanRepository({storage, now: () => 350});
    const plans = Array.from({length: 15}, (_, index) =>
      plan({localId: `bulk-plan-${index}`, updatedAt: index}),
    );
    for (const current of plans) {
      await repository.save(current);
    }
    storage.resetCounts();

    const result = await repository.deleteManyIf?.(
      plans.map(current => ({
        localId: current.localId,
        predicate: stored => stored.updatedAt === current.updatedAt,
      })),
    );

    expect(result && [...result.values()]).toEqual(
      Array.from({length: 15}, () => 'deleted'),
    );
    expect(storage.mainWrites).toBe(1);
    expect(await repository.list()).toEqual([]);
  });

  it('preserves plans that no longer match a bulk delete snapshot', async () => {
    const repository = new PersistentDivePlanRepository({
      storage: new InMemoryKeyValueStore(),
      now: () => 350,
    });
    const exact = plan({localId: 'exact', updatedAt: 100});
    const changed = plan({localId: 'changed', updatedAt: 200});
    await repository.save(exact);
    await repository.save(changed);

    const result = await repository.deleteManyIf?.([
      {localId: exact.localId, predicate: current => current.updatedAt === 100},
      {localId: changed.localId, predicate: current => current.updatedAt === 100},
    ]);

    expect(result?.get('exact')).toBe('deleted');
    expect(result?.get('changed')).toBe('conditionFailed');
    expect((await repository.list()).map(value => value.localId)).toEqual([
      'changed',
    ]);
  });

  it('serializes conditional delete behind a queued save and preserves the changed plan', async () => {
    const storage = new PausedWriteStore();
    const repository = new PersistentDivePlanRepository({storage, now: () => 350});
    const original = plan({localId: 'racing-plan', updatedAt: 100});
    const changed = {...original, status: 'completed' as const, updatedAt: 200};
    await repository.save(original);
    storage.pauseNextWrite();

    const saving = repository.save(changed);
    await storage.writeStarted;
    const deleting = (repository as unknown as {
      deleteIf(
        localId: string,
        predicate: (current: DivePlan) => boolean,
      ): Promise<string>;
    }).deleteIf('racing-plan', current => current.updatedAt === original.updatedAt);
    storage.releaseWrite();

    await expect(saving).resolves.toMatchObject({updatedAt: 200});
    await expect(deleting).resolves.toBe('conditionFailed');
    await expect(repository.get('racing-plan')).resolves.toMatchObject({
      status: 'completed',
      updatedAt: 200,
    });
  });

  it('rejects malformed nested plan fields at the unknown migration entry point', () => {
    const malformedPlan = plan({
      plannedValues: {
        plannedPressure: { unit: 'bar', start: 'full' as unknown as number },
      },
    });

    expect(() => migrateDivePlanbookEnvelope({
      schemaVersion: 3,
      updatedAt: 350,
      value: [malformedPlan],
    } as unknown)).toThrow(/planbook/i);
  });

  it('honors an explicit metadata storage key', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDivePlanRepository({
      storage,
      storageKey: 'custom-planbook',
      now: () => 350,
    });

    await repository.save(plan({ localId: 'custom-key-plan' }));

    expect(await storage.getString('custom-planbook')).toBeDefined();
    expect(await storage.getString(mobileStorageKeys.planbook)).toBeUndefined();
  });

  it('saves, reloads, sorts, and deletes persisted plans', async () => {
    const storage = new InMemoryKeyValueStore();
    const repository = new PersistentDivePlanRepository({ storage, now: () => 350 });

    await repository.save(plan({ localId: 'completed', status: 'completed', completedAt: 210, updatedAt: 210 }));
    await repository.save(plan({ localId: 'future-planned', status: 'planned', plannedAt: 500, updatedAt: 150 }));
    await repository.save(plan({ localId: 'draft', status: 'draft', updatedAt: 300 }));
    await repository.save(plan({ localId: 'near-planned', status: 'planned', plannedAt: 400, updatedAt: 180 }));

    const reloadedRepository = new PersistentDivePlanRepository({ storage, now: () => 350 });

    expect((await reloadedRepository.list()).map(currentPlan => currentPlan.localId)).toEqual([
      'near-planned',
      'future-planned',
      'draft',
      'completed',
    ]);

    await reloadedRepository.delete('draft');

    expect((await new PersistentDivePlanRepository({ storage, now: () => 350 }).list()).map(currentPlan => currentPlan.localId)).toEqual([
      'near-planned',
      'future-planned',
      'completed',
    ]);
  });

  it('matches the local repository sort order', async () => {
    const plans = [
      plan({ localId: 'completed', status: 'completed', completedAt: 210, updatedAt: 210 }),
      plan({ localId: 'future-planned', status: 'planned', plannedAt: 500, updatedAt: 150 }),
      plan({ localId: 'draft', status: 'draft', updatedAt: 300 }),
      plan({ localId: 'near-planned', status: 'planned', plannedAt: 400, updatedAt: 180 }),
    ];
    const persistentRepository = new PersistentDivePlanRepository({ storage: new InMemoryKeyValueStore(), now: () => 350 });
    const localRepository = new LocalDivePlanRepository(plans, { now: () => 350 });

    for (const currentPlan of plans) {
      await persistentRepository.save(currentPlan);
    }

    expect((await persistentRepository.list()).map(currentPlan => currentPlan.localId)).toEqual(
      (await localRepository.list()).map(currentPlan => currentPlan.localId),
    );
  });

  it('returns cloned plans so callers cannot mutate persisted state', async () => {
    const repository = new PersistentDivePlanRepository({ storage: new InMemoryKeyValueStore(), now: () => 350 });

    const saved = await repository.save(
      plan({
        localId: 'plan-1',
        site: { name: 'Original Reef' },
        checklistItems: [{ id: 'gear', label: 'Gear', completed: false }],
      }),
    );

    saved.site.name = 'Mutated Reef';
    saved.checklistItems[0].completed = true;

    expect((await repository.get('plan-1'))?.site.name).toBe('Original Reef');
    expect((await repository.get('plan-1'))?.checklistItems[0].completed).toBe(false);
  });

  it('does not load pre-reset v1 planbook entries', async () => {
    const storage = new InMemoryKeyValueStore();
    await storage.setString(
      'dive-app:planbook:v1',
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 350,
        value: [plan({ localId: 'legacy-v1-plan', site: { name: 'Legacy Reef' } })],
      }),
    );

    const repository = new PersistentDivePlanRepository({ storage, now: () => 350 });

    expect(await repository.list()).toEqual([]);
  });
});
