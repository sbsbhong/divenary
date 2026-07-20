import { AccountOutbox, type AccountOutboxItem } from '../src/sync/account-outbox';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import type {PersistentKeyValueStore} from '../src/storage/persistent-key-value-store';

const userId = '00000000-0000-4000-8000-000000000001';

function item(overrides: Partial<AccountOutboxItem> = {}): AccountOutboxItem {
  return {
    operationId: 'operation-1',
    userId,
    entityKind: 'log',
    entityLocalId: 'local-log-1',
    mutation: 'upsert',
    payload: {remote: {id: 'remote-log-1'}},
    attemptCount: 0,
    nextAttemptAt: 100,
    createdAt: 100,
    ...overrides,
  };
}

describe('AccountOutbox', () => {
  it('persists operations and accepts only an identical immutable duplicate', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'account-outbox'});

    await outbox.enqueue(item());
    await expect(outbox.enqueue(item())).resolves.toEqual(item());
    await expect(
      outbox.enqueue(item({payload: {remote: {id: 'changed'}}})),
    ).rejects.toThrow('operation-1');

    await expect(outbox.list(userId)).resolves.toEqual([item()]);
    await expect(
      new AccountOutbox({storage, storageKey: 'account-outbox'}).list(userId),
    ).resolves.toEqual([item()]);
  });

  it('removes only an unqueued operation-owned profile snapshot', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'account-outbox'});
    const orphanKey = await outbox.writeProfileSnapshot(
      userId,
      'orphan-operation',
      '[{"depthMeters":3}]',
    );

    await expect(
      outbox.removeUnreferencedProfileSnapshot(userId, 'orphan-operation'),
    ).resolves.toBe(true);
    await expect(storage.getString(orphanKey)).resolves.toBeUndefined();

    const retainedKey = await outbox.writeProfileSnapshot(
      userId,
      'retained-operation',
      '[{"depthMeters":4}]',
    );
    await outbox.enqueue(
      item({operationId: 'retained-operation', profileStorageKey: retainedKey}),
    );

    await expect(
      outbox.removeUnreferencedProfileSnapshot(userId, 'retained-operation'),
    ).resolves.toBe(false);
    await expect(storage.getString(retainedKey)).resolves.toBe(
      '[{"depthMeters":4}]',
    );
  });

  it('allows the same operation id for different users and binds mutations to the user', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'account-outbox'});
    const otherUserId = '00000000-0000-4000-8000-000000000002';
    await outbox.enqueue(item());
    await outbox.enqueue(item({userId: otherUserId}));

    await outbox.complete(userId, 'operation-1');

    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(outbox.list(otherUserId)).resolves.toEqual([
      item({userId: otherUserId}),
    ]);
  });

  it('fails closed for corrupt JSON and envelopes with non-exact keys', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'account-outbox'});
    await storage.setString('account-outbox', '{not-json');
    await expect(outbox.list()).rejects.toThrow('Malformed account outbox envelope');

    await storage.setString(
      'account-outbox',
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 100,
        value: {items: [], conflicts: []},
        unexpected: true,
      }),
    );
    await expect(outbox.list()).rejects.toThrow('Malformed account outbox envelope');

    await storage.setString(
      'account-outbox',
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 100,
        value: {items: [{...item(), unexpected: true}], conflicts: []},
      }),
    );
    await expect(outbox.list()).rejects.toThrow('Malformed account outbox item');
  });

  it('preserves insertion order independently of retry due times', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'account-outbox',
    });
    await outbox.enqueue(item({operationId: 'first', nextAttemptAt: 500}));
    await outbox.enqueue(item({operationId: 'second', nextAttemptAt: 100}));

    await expect(outbox.list(userId)).resolves.toEqual([
      item({operationId: 'first', nextAttemptAt: 500}),
      item({operationId: 'second', nextAttemptAt: 100}),
    ]);
  });

  it('serializes read-modify-write mutations across outbox instances sharing a key', async () => {
    const storage = new FirstWritePausedStorage();
    const firstOutbox = new AccountOutbox({storage, storageKey: 'account-outbox'});
    const secondOutbox = new AccountOutbox({storage, storageKey: 'account-outbox'});

    const firstWrite = firstOutbox.enqueue(item({operationId: 'first'}));
    await storage.firstWriteStarted;
    const secondWrite = secondOutbox.enqueue(item({operationId: 'second'}));
    await Promise.resolve();
    await Promise.resolve();
    storage.releaseFirstWrite();
    await Promise.all([firstWrite, secondWrite]);

    await expect(firstOutbox.list(userId)).resolves.toEqual([
      item({operationId: 'first'}),
      item({operationId: 'second'}),
    ]);
  });

  it('reschedules with deterministic exponential backoff and injected jitter', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'account-outbox',
      now: () => 1_000,
      jitter: () => 0.25,
    });
    await outbox.enqueue(item());

    await outbox.reschedule(userId, 'operation-1');
    expect((await outbox.list(userId))[0]).toMatchObject({
      attemptCount: 1,
      nextAttemptAt: 1_002.25,
    });

    for (let attempt = 1; attempt < 9; attempt += 1) {
      await outbox.reschedule(userId, 'operation-1');
    }
    expect((await outbox.list(userId))[0]).toMatchObject({
      attemptCount: 9,
      nextAttemptAt: 1_300.25,
    });
  });

  it('records a conflict separately while atomically removing its operation', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'account-outbox',
      now: () => 200,
    });
    const operation = item();
    const remote = {id: 'remote-log-1', revision: 3};
    await outbox.enqueue(operation);

    const currentLocal = {localId: 'local-log-1', notes: 'current'};
    await outbox.recordConflict(operation, currentLocal, remote);

    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(outbox.listConflicts(userId)).resolves.toEqual([
      {
        operationId: operation.operationId,
        userId,
        entityKind: 'log',
        entityLocalId: 'local-log-1',
        localPayload: currentLocal,
        remote,
        recordedAt: 200,
      },
    ]);
  });

  it('restores the exact envelope and retained snapshot when a guarded rebase becomes stale during persistence', async () => {
    const storage = new PausedNextWriteStorage();
    const outbox = new AccountOutbox({
      storage,
      storageKey: 'account-outbox',
      now: () => 200,
    });
    const profileStorageKey = await outbox.writeProfileSnapshot(
      userId,
      'operation-1',
      '[{"depthMeters":3}]',
    );
    const first = item({profileStorageKey});
    const second = item({operationId: 'operation-2', createdAt: 101});
    await outbox.enqueue(first);
    await outbox.enqueue(second);
    const rawBefore = await storage.getString('account-outbox');
    const itemsBefore = await outbox.list(userId);
    let isCurrent = true;
    const pausedWrite = storage.pauseNextWrite();
    let completionError: unknown;
    const observedCompletion = outbox
      .completeSavedUpsert(first, 2, {
        assertCanCommit: () => {
          if (!isCurrent) {
            throw new Error('stale principal');
          }
        },
      })
      .catch(error => {
        completionError = error;
      });
    await pausedWrite.started;

    isCurrent = false;
    pausedWrite.release();
    await observedCompletion;

    expect((completionError as Error | undefined)?.message).toBe(
      'stale principal',
    );
    await expect(storage.getString('account-outbox')).resolves.toBe(rawBefore);
    await expect(outbox.list(userId)).resolves.toEqual(itemsBefore);
    await expect(storage.getString(profileStorageKey)).resolves.toBe(
      '[{"depthMeters":3}]',
    );
  });

  it('restores the exact queue and conflict envelope when conflict persistence becomes stale', async () => {
    const storage = new PausedNextWriteStorage();
    const outbox = new AccountOutbox({
      storage,
      storageKey: 'account-outbox',
      now: () => 200,
    });
    const operation = item();
    await outbox.enqueue(operation);
    const rawBefore = await storage.getString('account-outbox');
    let isCurrent = true;
    const pausedWrite = storage.pauseNextWrite();
    let conflictError: unknown;
    const observedConflict = outbox
      .recordConflict(
        operation,
        {localId: operation.entityLocalId},
        {id: 'remote-log-1', revision: 3},
        {
          assertCanCommit: () => {
            if (!isCurrent) {
              throw new Error('stale principal');
            }
          },
        },
      )
      .catch(error => {
        conflictError = error;
      });
    await pausedWrite.started;

    isCurrent = false;
    pausedWrite.release();
    await observedConflict;

    expect((conflictError as Error | undefined)?.message).toBe(
      'stale principal',
    );
    await expect(storage.getString('account-outbox')).resolves.toBe(rawBefore);
    await expect(outbox.list(userId)).resolves.toEqual([operation]);
    await expect(outbox.listConflicts(userId)).resolves.toEqual([]);
  });

  it('restores an absent envelope when guarded completion becomes stale', async () => {
    const storage = new PausedNextWriteStorage();
    const outbox = new AccountOutbox({
      storage,
      storageKey: 'account-outbox',
      now: () => 200,
    });
    let isCurrent = true;
    const pausedWrite = storage.pauseNextWrite();
    let completionError: unknown;
    const observedCompletion = outbox
      .complete(userId, 'missing-operation', {
        assertCanCommit: () => {
          if (!isCurrent) {
            throw new Error('stale principal');
          }
        },
      })
      .catch(error => {
        completionError = error;
      });
    await pausedWrite.started;

    isCurrent = false;
    pausedWrite.release();
    await observedCompletion;

    expect((completionError as Error | undefined)?.message).toBe(
      'stale principal',
    );
    await expect(storage.getString('account-outbox')).resolves.toBeUndefined();
  });
});

class PausedNextWriteStorage implements PersistentKeyValueStore {
  private readonly values = new Map<string, string>();
  private nextPause?: {
    resolveStarted: () => void;
    release: Promise<void>;
  };

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    const pause = this.nextPause;
    this.nextPause = undefined;
    if (pause) {
      pause.resolveStarted();
      await pause.release;
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  pauseNextWrite(): {started: Promise<void>; release(): void} {
    let resolveStarted!: () => void;
    let resolveRelease!: () => void;
    const started = new Promise<void>(resolve => {
      resolveStarted = resolve;
    });
    const release = new Promise<void>(resolve => {
      resolveRelease = resolve;
    });
    this.nextPause = {resolveStarted, release};
    return {started, release: resolveRelease};
  }
}

class FirstWritePausedStorage implements PersistentKeyValueStore {
  private readonly values = new Map<string, string>();
  private writeCount = 0;
  private resolveFirstWriteStarted!: () => void;
  private resolveFirstWrite!: () => void;
  readonly firstWriteStarted = new Promise<void>(resolve => {
    this.resolveFirstWriteStarted = resolve;
  });

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    this.writeCount += 1;
    if (this.writeCount === 1) {
      this.resolveFirstWriteStarted();
      await new Promise<void>(resolve => {
        this.resolveFirstWrite = resolve;
      });
    }
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  releaseFirstWrite(): void {
    this.resolveFirstWrite();
  }
}
