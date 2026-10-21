import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';
import { mobileStorageKeys } from '../src/storage/storage-keys';
import { createWatchRejectedPayloadStore } from '../src/storage/watch-rejected-payload-store';

describe('watch rejected payload store', () => {
  test('keeps the newest rejection first and replaces repeats of the same session', async () => {
    let now = 1_781_355_000;
    const store = createWatchRejectedPayloadStore({ storage: new InMemoryKeyValueStore(), now: () => now });

    await store.recordRejection({ payloadId: 'p1', localSessionId: 's1', reason: 'invalidMessage' });
    now += 10;
    await store.recordRejection({ payloadId: 'p2', localSessionId: 's2', reason: 'invalidPreparedPayload' });
    now += 10;
    await store.recordRejection({ payloadId: 'p3', localSessionId: 's1', reason: 'repeatedImportFailure' });

    await expect(store.list()).resolves.toEqual([
      { payloadId: 'p3', localSessionId: 's1', reason: 'repeatedImportFailure', rejectedAt: 1_781_355_020 },
      { payloadId: 'p2', localSessionId: 's2', reason: 'invalidPreparedPayload', rejectedAt: 1_781_355_010 },
    ]);
  });

  test('keeps at most twenty rejections', async () => {
    const store = createWatchRejectedPayloadStore({ storage: new InMemoryKeyValueStore(), now: () => 1 });

    for (let index = 0; index < 25; index += 1) {
      await store.recordRejection({ payloadId: `p${index}`, reason: 'invalidMessage' });
    }

    const rejections = await store.list();
    expect(rejections).toHaveLength(20);
    expect(rejections[0]?.payloadId).toBe('p24');
  });

  test('counts consecutive import failures per payload until cleared', async () => {
    const store = createWatchRejectedPayloadStore({ storage: new InMemoryKeyValueStore() });

    await expect(store.recordImportFailure('p1')).resolves.toBe(1);
    await expect(store.recordImportFailure('p1')).resolves.toBe(2);
    await expect(store.recordImportFailure('p2')).resolves.toBe(1);
    await store.clearImportFailures('p1');
    await expect(store.recordImportFailure('p1')).resolves.toBe(1);
  });

  test('notifies subscribers and clears the list', async () => {
    const store = createWatchRejectedPayloadStore({ storage: new InMemoryKeyValueStore() });
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    await store.recordRejection({ payloadId: 'p1', reason: 'invalidMessage' });
    await store.clear();
    unsubscribe();
    await store.recordRejection({ payloadId: 'p2', reason: 'invalidMessage' });

    expect(listener).toHaveBeenCalledTimes(2);
    await expect(store.list()).resolves.toHaveLength(1);
  });

  test('treats an unreadable ledger as empty instead of failing imports', async () => {
    const storage = new InMemoryKeyValueStore();
    await storage.setString(mobileStorageKeys.watchRejectedPayloads, '{not json');
    const store = createWatchRejectedPayloadStore({ storage });

    await expect(store.list()).resolves.toEqual([]);
    await store.recordRejection({ payloadId: 'p1', reason: 'invalidMessage' });
    await expect(store.list()).resolves.toHaveLength(1);
  });
});
