import {
  PersistentJsonStore,
  type StoredEnvelope,
} from '../storage/persistent-json-store';
import type {PersistentKeyValueStore} from '../storage/persistent-key-value-store';

export type AccountOutboxItem = {
  operationId: string;
  userId: string;
  entityKind: 'log' | 'plan';
  entityLocalId: string;
  mutation: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  expectedRevision?: number;
  profileStorageKey?: string;
  attemptCount: number;
  nextAttemptAt: number;
  createdAt: number;
};

export type AccountOutboxConflict = {
  operationId: string;
  userId: string;
  entityKind: 'log' | 'plan';
  entityLocalId: string;
  localPayload: Record<string, unknown>;
  remote: Record<string, unknown>;
  recordedAt: number;
};

type AccountOutboxState = {
  items: AccountOutboxItem[];
  conflicts: AccountOutboxConflict[];
};

type AccountOutboxOptions = {
  storage: PersistentKeyValueStore;
  storageKey: string;
  now?: () => number;
  jitter?: () => number;
};

const SCHEMA_VERSION = 1;
const MAXIMUM_RETRY_DELAY_SECONDS = 300;

export class AccountOutbox {
  private readonly store: PersistentJsonStore<AccountOutboxState>;
  private readonly now: () => number;
  private readonly jitter: () => number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: AccountOutboxOptions) {
    this.now = options.now ?? (() => Date.now() / 1_000);
    this.jitter = options.jitter ?? Math.random;
    this.store = new PersistentJsonStore<AccountOutboxState>({
      key: options.storageKey,
      schemaVersion: SCHEMA_VERSION,
      defaultValue: emptyState,
      migrate: migrateOutboxEnvelope,
      storage: options.storage,
      now: this.now,
    });
  }

  async list(userId?: string): Promise<AccountOutboxItem[]> {
    const state = await this.store.read();
    return state.items
      .filter(item => userId === undefined || item.userId === userId)
      .map(cloneItem)
      .sort(compareItems);
  }

  async listConflicts(userId?: string): Promise<AccountOutboxConflict[]> {
    const state = await this.store.read();
    return state.conflicts
      .filter(conflict => userId === undefined || conflict.userId === userId)
      .map(cloneConflict)
      .sort((left, right) => left.recordedAt - right.recordedAt);
  }

  async enqueue(item: AccountOutboxItem): Promise<AccountOutboxItem> {
    assertItem(item);
    return this.mutate(async state => {
      const existing = state.items.find(candidate => candidate.operationId === item.operationId);
      if (existing) {
        return cloneItem(existing);
      }

      const stored = cloneItem(item);
      state.items.push(stored);
      return cloneItem(stored);
    });
  }

  async complete(operationId: string): Promise<void> {
    await this.mutate(async state => {
      state.items = state.items.filter(item => item.operationId !== operationId);
    });
  }

  async completeSavedUpsert(
    item: AccountOutboxItem,
    remoteRevision: number,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(remoteRevision) || remoteRevision < 1) {
      throw new Error('Remote revision must be a positive integer');
    }
    return this.mutate(async state => {
      state.items = state.items.filter(
        candidate => candidate.operationId !== item.operationId,
      );
      const pending = state.items.filter(
        candidate =>
          candidate.userId === item.userId &&
          candidate.entityKind === item.entityKind &&
          candidate.entityLocalId === item.entityLocalId &&
          candidate.mutation === 'upsert',
      );
      for (const candidate of pending) {
        candidate.expectedRevision = remoteRevision;
        updatePayloadRevision(candidate.payload, remoteRevision);
      }
      return pending.length > 0;
    });
  }

  async reschedule(operationId: string): Promise<AccountOutboxItem | undefined> {
    return this.mutate(async state => {
      const item = state.items.find(candidate => candidate.operationId === operationId);
      if (!item) {
        return undefined;
      }

      const jitter = this.jitter();
      if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1) {
        throw new Error('Account outbox jitter must be in [0, 1)');
      }

      const attemptCount = item.attemptCount + 1;
      item.attemptCount = attemptCount;
      item.nextAttemptAt =
        this.now() +
        Math.min(MAXIMUM_RETRY_DELAY_SECONDS, 2 ** attemptCount) +
        jitter;
      return cloneItem(item);
    });
  }

  async recordConflict(
    item: AccountOutboxItem,
    remote: Record<string, unknown>,
  ): Promise<void> {
    await this.mutate(async state => {
      const existing = state.conflicts.find(
        conflict => conflict.operationId === item.operationId,
      );
      if (!existing) {
        state.conflicts.push({
          operationId: item.operationId,
          userId: item.userId,
          entityKind: item.entityKind,
          entityLocalId: item.entityLocalId,
          localPayload: cloneRecord(item.payload),
          remote: cloneRecord(remote),
          recordedAt: this.now(),
        });
      }
      state.items = state.items.filter(
        candidate => candidate.operationId !== item.operationId,
      );
    });
  }

  async removePendingEntity(
    userId: string,
    entityKind: AccountOutboxItem['entityKind'],
    entityLocalId: string,
  ): Promise<void> {
    await this.mutate(async state => {
      state.items = state.items.filter(
        item =>
          item.userId !== userId ||
          item.entityKind !== entityKind ||
          item.entityLocalId !== entityLocalId,
      );
    });
  }

  private mutate<T>(
    operation: (state: AccountOutboxState) => Promise<T>,
  ): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      const state = await this.store.read();
      const value = await operation(state);
      await this.store.write(state);
      return value;
    });
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function migrateOutboxEnvelope(
  envelope: StoredEnvelope<unknown>,
): AccountOutboxState {
  if (envelope.schemaVersion !== SCHEMA_VERSION || !isRecord(envelope.value)) {
    throw new Error('Unsupported account outbox envelope');
  }
  const items = Reflect.get(envelope.value, 'items');
  const conflicts = Reflect.get(envelope.value, 'conflicts');
  if (!Array.isArray(items) || !Array.isArray(conflicts)) {
    throw new Error('Malformed account outbox envelope');
  }
  items.forEach(assertItem);
  conflicts.forEach(assertConflict);
  return {
    items: items.map(cloneItem),
    conflicts: conflicts.map(cloneConflict),
  };
}

function emptyState(): AccountOutboxState {
  return {items: [], conflicts: []};
}

function assertItem(value: unknown): asserts value is AccountOutboxItem {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.operationId) ||
    !isNonEmptyString(value.userId) ||
    (value.entityKind !== 'log' && value.entityKind !== 'plan') ||
    !isNonEmptyString(value.entityLocalId) ||
    (value.mutation !== 'upsert' && value.mutation !== 'delete') ||
    !isRecord(value.payload) ||
    !isOptionalPositiveInteger(value.expectedRevision) ||
    (value.profileStorageKey !== undefined &&
      !isNonEmptyString(value.profileStorageKey)) ||
    typeof value.attemptCount !== 'number' ||
    !Number.isSafeInteger(value.attemptCount) ||
    value.attemptCount < 0 ||
    !isFiniteNumber(value.nextAttemptAt) ||
    !isFiniteNumber(value.createdAt)
  ) {
    throw new Error('Malformed account outbox item');
  }
}

function assertConflict(value: unknown): asserts value is AccountOutboxConflict {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.operationId) ||
    !isNonEmptyString(value.userId) ||
    (value.entityKind !== 'log' && value.entityKind !== 'plan') ||
    !isNonEmptyString(value.entityLocalId) ||
    !isRecord(value.localPayload) ||
    !isRecord(value.remote) ||
    !isFiniteNumber(value.recordedAt)
  ) {
    throw new Error('Malformed account outbox conflict');
  }
}

function compareItems(left: AccountOutboxItem, right: AccountOutboxItem): number {
  return (
    left.nextAttemptAt - right.nextAttemptAt ||
    left.createdAt - right.createdAt ||
    left.operationId.localeCompare(right.operationId)
  );
}

function cloneItem(item: AccountOutboxItem): AccountOutboxItem {
  return cloneValue(item);
}

function cloneConflict(conflict: AccountOutboxConflict): AccountOutboxConflict {
  return cloneValue(conflict);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneValue(value);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function updatePayloadRevision(
  payload: Record<string, unknown>,
  remoteRevision: number,
): void {
  if (isRecord(payload.remote)) {
    payload.remote.revision = remoteRevision;
  }
  if (isRecord(payload.local)) {
    payload.local.remoteRevision = remoteRevision;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1
  );
}
