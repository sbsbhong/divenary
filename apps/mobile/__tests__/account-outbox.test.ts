import { AccountOutbox, type AccountOutboxItem } from '../src/sync/account-outbox';
import { InMemoryKeyValueStore } from '../src/storage/in-memory-key-value-store';

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
  it('persists operations and treats a repeated operation id as idempotent', async () => {
    const storage = new InMemoryKeyValueStore();
    const outbox = new AccountOutbox({storage, storageKey: 'account-outbox'});

    await outbox.enqueue(item());
    await outbox.enqueue(item({payload: {remote: {id: 'changed'}}}));

    await expect(outbox.list(userId)).resolves.toEqual([item()]);
    await expect(
      new AccountOutbox({storage, storageKey: 'account-outbox'}).list(userId),
    ).resolves.toEqual([item()]);
  });

  it('reschedules with deterministic exponential backoff and injected jitter', async () => {
    const outbox = new AccountOutbox({
      storage: new InMemoryKeyValueStore(),
      storageKey: 'account-outbox',
      now: () => 1_000,
      jitter: () => 0.25,
    });
    await outbox.enqueue(item());

    await outbox.reschedule('operation-1');
    expect((await outbox.list(userId))[0]).toMatchObject({
      attemptCount: 1,
      nextAttemptAt: 1_002.25,
    });

    for (let attempt = 1; attempt < 9; attempt += 1) {
      await outbox.reschedule('operation-1');
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

    await outbox.recordConflict(operation, remote);

    await expect(outbox.list(userId)).resolves.toEqual([]);
    await expect(outbox.listConflicts(userId)).resolves.toEqual([
      {
        operationId: operation.operationId,
        userId,
        entityKind: 'log',
        entityLocalId: 'local-log-1',
        localPayload: operation.payload,
        remote,
        recordedAt: 200,
      },
    ]);
  });
});
