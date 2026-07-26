import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import {
  PersistentJsonReadError,
  PersistentJsonStore,
  type PersistentJsonStoreOptions,
  UnsupportedStorageVersionError,
} from '../src/storage/persistent-json-store';

type StoredValue = {
  label: string;
};

const createStore = (
  storage = new InMemoryKeyValueStore(),
  options: Partial<PersistentJsonStoreOptions<StoredValue>> = {},
) => {
  const readErrors: Error[] = [];

  return {
    storage,
    readErrors,
    jsonStore: new PersistentJsonStore<StoredValue>({
      key: 'test:value:v1',
      schemaVersion: 1,
      defaultValue: () => ({ label: 'default' }),
      migrate: envelope => {
        if (envelope.schemaVersion !== 1) {
          throw new UnsupportedStorageVersionError('test:value:v1', envelope.schemaVersion);
        }

        return envelope.value as StoredValue;
      },
      now: () => 1234,
      onReadError: error => readErrors.push(error),
      storage,
      ...options,
    }),
  };
};

async function createInterruptedJournalFixture(
  boundary: 'after-pending' | 'after-commit' | 'after-main',
) {
  const storage = new InMemoryKeyValueStore();
  const mainKey = 'test:value:v1';
  const recoveryKeys = {
    pending: `${mainKey}:pending`,
    commit: `${mainKey}:commit`,
    quarantinePrefix: `${mainKey}:quarantine:`,
  };
  const oldMainBytes = JSON.stringify({
    schemaVersion: 1,
    updatedAt: 100,
    value: {label: 'old'},
  });
  const expectedMainBytes = JSON.stringify({
    schemaVersion: 1,
    updatedAt: 200,
    value: {label: 'new'},
  });
  await storage.setString(mainKey, oldMainBytes);
  await storage.setString(recoveryKeys.pending, expectedMainBytes);

  if (boundary !== 'after-pending') {
    await storage.setString(
      recoveryKeys.commit,
      JSON.stringify({
        schemaVersion: 1,
        digest: bytesToHex(sha256(utf8ToBytes(expectedMainBytes))),
        byteCount: utf8ToBytes(expectedMainBytes).length,
      }),
    );
  }
  if (boundary === 'after-main') {
    await storage.setString(mainKey, expectedMainBytes);
  }

  const {jsonStore: store} = createStore(storage, {
    recoveryKeys,
    readFailurePolicy: 'throw',
  });
  return boundary === 'after-pending'
    ? {
        store,
        storage,
        mainKey,
        expected: {label: 'old'},
        expectedMainBytes: oldMainBytes,
      }
    : {
        store,
        storage,
        mainKey,
        expected: {label: 'new'},
        expectedMainBytes,
      };
}

describe('PersistentJsonStore', () => {
  it('returns the default value when no payload exists', async () => {
    const { jsonStore } = createStore();

    await expect(jsonStore.read()).resolves.toEqual({ label: 'default' });
  });

  it('writes and reads a versioned envelope', async () => {
    const { jsonStore, storage } = createStore();

    await jsonStore.write({ label: 'saved' });

    expect(await storage.getString('test:value:v1')).toBe(
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: 1234,
        value: { label: 'saved' },
      }),
    );
    await expect(jsonStore.read()).resolves.toEqual({ label: 'saved' });
  });

  it('returns the default value and records a read error for invalid JSON', async () => {
    const { jsonStore, storage, readErrors } = createStore();

    await storage.setString('test:value:v1', '{bad json');

    await expect(jsonStore.read()).resolves.toEqual({ label: 'default' });
    expect(readErrors[0]).toBeInstanceOf(Error);
  });

  it('returns the default value and records a read error for unsupported future versions', async () => {
    const { jsonStore, storage, readErrors } = createStore();

    await storage.setString(
      'test:value:v1',
      JSON.stringify({
        schemaVersion: 99,
        updatedAt: 1234,
        value: { label: 'future' },
      }),
    );

    await expect(jsonStore.read()).resolves.toEqual({ label: 'default' });
    expect(readErrors[0]).toBeInstanceOf(UnsupportedStorageVersionError);
  });

  it('throws and preserves malformed durable bytes instead of returning the default', async () => {
    const storage = new InMemoryKeyValueStore();
    const raw = '{"schemaVersion":3,"updatedAt":1,"value":[';
    await storage.setString('test:value:v1', raw);
    const {jsonStore: store} = createStore(storage, {
      readFailurePolicy: 'throw',
      recoveryKeys: {
        pending: 'test:value:v1:pending',
        commit: 'test:value:v1:commit',
        quarantinePrefix: 'test:value:v1:quarantine:',
      },
    });

    await expect(store.read()).rejects.toBeInstanceOf(PersistentJsonReadError);
    await expect(storage.getString('test:value:v1')).resolves.toBe(raw);
  });

  it.each([
    'after-pending',
    'after-commit',
    'after-main',
  ] as const)('recovers deterministically when interrupted %s', async boundary => {
    const fixture = await createInterruptedJournalFixture(boundary);
    const result = await fixture.store.read();
    expect(result).toEqual(fixture.expected);
    expect(await fixture.storage.getString(fixture.mainKey))
      .toBe(fixture.expectedMainBytes);
  });

  it('removes a stored payload', async () => {
    const { jsonStore, storage } = createStore();

    await jsonStore.write({ label: 'saved' });
    await jsonStore.remove();

    await expect(storage.getString('test:value:v1')).resolves.toBeUndefined();
  });
});
