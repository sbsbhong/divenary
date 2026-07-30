import {
  WatchLogDeletionStorageError,
  createWatchLogDeletionStore,
} from '../src/deletion/watch-log-deletion-store';
import type {PersistentKeyValueStore} from '../src/storage/persistent-key-value-store';
import {mobileStorageKeys} from '../src/storage/storage-keys';

describe('WatchLogDeletionStore', () => {
  it('keeps a permanent tombstone after Watch acknowledgement', async () => {
    const storage = new MemoryStorage();
    const store = createWatchLogDeletionStore({storage});

    await store.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: 'log-1',
      contentRevision: 'revision-1',
      artifactSha256: 'a'.repeat(64),
      requestedAt: 100,
    });
    await store.acknowledge('watch-session-1', 110);

    expect(await store.get('watch-session-1')).toEqual({
      schemaVersion: 1,
      localSessionId: 'watch-session-1',
      requestedAt: 100,
      sourceLocalIds: ['log-1'],
      expectedArtifact: {
        contentRevision: 'revision-1',
        artifactSha256: 'a'.repeat(64),
      },
      watchAcknowledgedAt: 110,
    });
  });

  it('merges repeated deletion evidence by logical Watch session', async () => {
    const storage = new MemoryStorage();
    const store = createWatchLogDeletionStore({storage});

    await store.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: 'log-2',
      requestedAt: 120,
    });
    await store.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: 'log-1',
      contentRevision: 'revision-1',
      artifactSha256: 'b'.repeat(64),
      requestedAt: 100,
    });
    await store.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: 'log-1',
      requestedAt: 130,
    });

    expect(await store.list()).toEqual([
      {
        schemaVersion: 1,
        localSessionId: 'watch-session-1',
        requestedAt: 100,
        sourceLocalIds: ['log-1', 'log-2'],
        expectedArtifact: {
          contentRevision: 'revision-1',
          artifactSha256: 'b'.repeat(64),
        },
      },
    ]);
  });

  it('serializes concurrent writes without dropping either session', async () => {
    const storage = new PausedFirstWriteStorage();
    const store = createWatchLogDeletionStore({storage});

    const first = store.record({
      localSessionId: 'watch-session-1',
      sourceLocalId: 'log-1',
      requestedAt: 100,
    });
    await storage.firstWriteStarted;
    const second = store.record({
      localSessionId: 'watch-session-2',
      sourceLocalId: 'log-2',
      requestedAt: 200,
    });
    storage.resumeFirstWrite();
    await Promise.all([first, second]);

    expect((await store.list()).map(value => value.localSessionId)).toEqual([
      'watch-session-1',
      'watch-session-2',
    ]);
  });

  it('fails closed when persisted deletion state is malformed', async () => {
    const storage = new MemoryStorage();
    await storage.setString(
      mobileStorageKeys.watchLogDeletions,
      JSON.stringify({
        schemaVersion: 1,
        tombstones: [
          {
            schemaVersion: 1,
            localSessionId: 'watch-session-1',
            requestedAt: 100,
            sourceLocalIds: [],
          },
        ],
      }),
    );
    const store = createWatchLogDeletionStore({storage});

    await expect(store.list()).rejects.toBeInstanceOf(
      WatchLogDeletionStorageError,
    );
  });

  it('rejects invalid artifact evidence before writing', async () => {
    const storage = new MemoryStorage();
    const store = createWatchLogDeletionStore({storage});

    await expect(
      store.record({
        localSessionId: 'watch-session-1',
        sourceLocalId: 'log-1',
        contentRevision: 'revision-1',
        artifactSha256: 'invalid',
        requestedAt: 100,
      }),
    ).rejects.toBeInstanceOf(WatchLogDeletionStorageError);
    expect(await storage.getString(mobileStorageKeys.watchLogDeletions)).toBeUndefined();
  });
});

class MemoryStorage implements PersistentKeyValueStore {
  protected readonly values = new Map<string, string>();

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class PausedFirstWriteStorage extends MemoryStorage {
  private resolveFirstWriteStarted!: () => void;
  private resolveResumeFirstWrite!: () => void;
  readonly firstWriteStarted = new Promise<void>(resolve => {
    this.resolveFirstWriteStarted = resolve;
  });
  private readonly resume = new Promise<void>(resolve => {
    this.resolveResumeFirstWrite = resolve;
  });
  private writeCount = 0;

  override async setString(key: string, value: string): Promise<void> {
    this.writeCount += 1;
    if (this.writeCount === 1) {
      this.resolveFirstWriteStarted();
      await this.resume;
    }
    await super.setString(key, value);
  }

  resumeFirstWrite(): void {
    this.resolveResumeFirstWrite();
  }
}
