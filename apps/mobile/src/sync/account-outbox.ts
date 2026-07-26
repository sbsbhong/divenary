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

export type AccountOutboxMutationOptions = {
  assertCanCommit?: () => void;
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
const ITEM_KEYS = [
  'operationId',
  'userId',
  'entityKind',
  'entityLocalId',
  'mutation',
  'payload',
  'expectedRevision',
  'profileStorageKey',
  'attemptCount',
  'nextAttemptAt',
  'createdAt',
] as const;
const CONFLICT_KEYS = [
  'operationId',
  'userId',
  'entityKind',
  'entityLocalId',
  'localPayload',
  'remote',
  'recordedAt',
] as const;
const storageMutationQueues = new Map<string, Promise<void>>();

export class AccountOutbox {
  private readonly storage: PersistentKeyValueStore;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly jitter: () => number;

  constructor(options: AccountOutboxOptions) {
    this.storage = options.storage;
    this.storageKey = options.storageKey;
    this.now = options.now ?? (() => Date.now() / 1_000);
    this.jitter = options.jitter ?? Math.random;
  }

  async list(userId?: string): Promise<AccountOutboxItem[]> {
    return withStorageMutationLock(this.storageKey, async () => {
      const state = await this.readState();
      return state.items
        .filter(item => userId === undefined || item.userId === userId)
        .map(cloneItem);
    });
  }

  async listEntity(
    userId: string,
    entityKind: AccountOutboxItem['entityKind'],
    entityLocalId: string,
  ): Promise<AccountOutboxItem[]> {
    return (await this.list(userId)).filter(
      item =>
        item.entityKind === entityKind && item.entityLocalId === entityLocalId,
    );
  }

  async listConflicts(userId?: string): Promise<AccountOutboxConflict[]> {
    return withStorageMutationLock(this.storageKey, async () => {
      const state = await this.readState();
      return state.conflicts
        .filter(conflict => userId === undefined || conflict.userId === userId)
        .map(cloneConflict);
    });
  }

  async enqueue(item: AccountOutboxItem): Promise<AccountOutboxItem> {
    assertItem(item);
    const normalized = cloneItem(item);
    if (
      normalized.profileStorageKey !== undefined &&
      normalized.profileStorageKey !==
        this.profileSnapshotKey(normalized.userId, normalized.operationId)
    ) {
      throw new Error('Account outbox profile key is not operation-owned');
    }

    return this.mutate(async state => {
      const existing = state.items.find(
        candidate =>
          candidate.userId === normalized.userId &&
          candidate.operationId === normalized.operationId,
      );
      if (existing) {
        if (!sameImmutableOperation(existing, normalized)) {
          throw new Error(
            `Account outbox operation ${normalized.operationId} changed`,
          );
        }
        return cloneItem(existing);
      }

      state.items.push(normalized);
      return cloneItem(normalized);
    });
  }

  async complete(
    userId: string,
    operationId: string,
    options?: AccountOutboxMutationOptions,
  ): Promise<void> {
    const removedProfileKeys = await this.mutate(async state => {
      const removed = state.items.filter(
        item => item.userId === userId && item.operationId === operationId,
      );
      state.items = state.items.filter(
        item => item.userId !== userId || item.operationId !== operationId,
      );
      return profileKeys(removed);
    }, options);
    await this.removeSnapshotsBestEffort(removedProfileKeys);
  }

  async completeSavedUpsert(
    item: AccountOutboxItem,
    remoteRevision: number,
    options?: AccountOutboxMutationOptions,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(remoteRevision) || remoteRevision < 1) {
      throw new Error('Remote revision must be a positive integer');
    }
    const result = await this.mutate(async state => {
      const operationIndex = state.items.findIndex(
        candidate => sameOperationKey(candidate, item),
      );
      if (operationIndex < 0) {
        return {hasPending: false, profileKeys: [] as string[]};
      }
      const [completed] = state.items.splice(operationIndex, 1);
      const pending = state.items.slice(operationIndex).filter(
        candidate => sameEntity(candidate, item),
      );
      for (const candidate of pending) {
        candidate.expectedRevision = remoteRevision;
        updatePayloadRevision(candidate.payload, remoteRevision);
      }
      return {
        hasPending: pending.length > 0,
        profileKeys: completed ? profileKeys([completed]) : [],
      };
    }, options);
    await this.removeSnapshotsBestEffort(result.profileKeys);
    return result.hasPending;
  }

  async hasLaterOperations(item: AccountOutboxItem): Promise<boolean> {
    const items = await this.list(item.userId);
    const operationIndex = items.findIndex(candidate => sameOperationKey(candidate, item));
    return (
      operationIndex >= 0 &&
      items.slice(operationIndex + 1).some(candidate => sameEntity(candidate, item))
    );
  }

  async reschedule(
    userId: string,
    operationId: string,
    options?: AccountOutboxMutationOptions,
  ): Promise<AccountOutboxItem | undefined> {
    return this.mutate(async state => {
      const item = state.items.find(
        candidate =>
          candidate.userId === userId && candidate.operationId === operationId,
      );
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
    }, options);
  }

  async recordConflict(
    item: AccountOutboxItem,
    currentLocal: Record<string, unknown>,
    remote: Record<string, unknown>,
    options?: AccountOutboxMutationOptions,
  ): Promise<void> {
    const removedProfileKeys = await this.mutate(async state => {
      const existing = state.conflicts.find(
        conflict =>
          conflict.userId === item.userId &&
          conflict.operationId === item.operationId,
      );
      if (!existing) {
        state.conflicts.push({
          operationId: item.operationId,
          userId: item.userId,
          entityKind: item.entityKind,
          entityLocalId: item.entityLocalId,
          localPayload: cloneRecord(currentLocal),
          remote: cloneRecord(remote),
          recordedAt: this.now(),
        });
      }
      const removed = state.items.filter(candidate => sameOperationKey(candidate, item));
      state.items = state.items.filter(candidate => !sameOperationKey(candidate, item));
      return profileKeys(removed);
    }, options);
    await this.removeSnapshotsBestEffort(removedProfileKeys);
  }

  async removePendingEntity(
    userId: string,
    entityKind: AccountOutboxItem['entityKind'],
    entityLocalId: string,
    options?: AccountOutboxMutationOptions,
  ): Promise<void> {
    const removedProfileKeys = await this.mutate(async state => {
      const removed = state.items.filter(
        item =>
          item.userId === userId &&
          item.entityKind === entityKind &&
          item.entityLocalId === entityLocalId,
      );
      state.items = state.items.filter(item => !removed.includes(item));
      return profileKeys(removed);
    }, options);
    await this.removeSnapshotsBestEffort(removedProfileKeys);
  }

  async removeEntityConflicts(
    userId: string,
    entityKind: AccountOutboxItem['entityKind'],
    entityLocalId: string,
    options?: AccountOutboxMutationOptions,
  ): Promise<void> {
    await this.mutate(async state => {
      state.conflicts = state.conflicts.filter(
        conflict =>
          conflict.userId !== userId ||
          conflict.entityKind !== entityKind ||
          conflict.entityLocalId !== entityLocalId,
      );
    }, options);
  }

  profileSnapshotKey(userId: string, operationId: string): string {
    return `${this.storageKey}:profile:${encodeURIComponent(
      userId,
    )}:${encodeURIComponent(operationId)}`;
  }

  async writeProfileSnapshot(
    userId: string,
    operationId: string,
    serializedProfile: string,
  ): Promise<string> {
    const key = this.profileSnapshotKey(userId, operationId);
    await this.storage.setString(key, serializedProfile);
    return key;
  }

  async readProfileSnapshot(item: AccountOutboxItem): Promise<string | undefined> {
    if (item.profileStorageKey === undefined) {
      return undefined;
    }
    if (
      item.profileStorageKey !==
      this.profileSnapshotKey(item.userId, item.operationId)
    ) {
      throw new Error('Account outbox profile key is not operation-owned');
    }
    return this.storage.getString(item.profileStorageKey);
  }

  async removeUnreferencedProfileSnapshot(
    userId: string,
    operationId: string,
  ): Promise<boolean> {
    return withStorageMutationLock(this.storageKey, async () => {
      const key = this.profileSnapshotKey(userId, operationId);
      const state = await this.readState();
      if (
        state.items.some(
          item =>
            item.userId === userId && item.profileStorageKey === key,
        )
      ) {
        return false;
      }
      await this.storage.remove(key);
      return true;
    });
  }

  private mutate<T>(
    operation: (state: AccountOutboxState) => Promise<T>,
    options?: AccountOutboxMutationOptions,
  ): Promise<T> {
    return withStorageMutationLock(this.storageKey, async () => {
      const previousRaw = await this.storage.getString(this.storageKey);
      const state = this.parseState(previousRaw);
      const value = await operation(state);
      options?.assertCanCommit?.();
      try {
        await this.writeState(state);
        options?.assertCanCommit?.();
      } catch (error) {
        await this.restoreRawState(previousRaw);
        throw error;
      }
      return value;
    });
  }

  private async readState(): Promise<AccountOutboxState> {
    const rawValue = await this.storage.getString(this.storageKey);
    return this.parseState(rawValue);
  }

  private parseState(rawValue: string | undefined): AccountOutboxState {
    if (rawValue === undefined) {
      return emptyState();
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(rawValue) as unknown;
    } catch {
      throw new Error('Malformed account outbox envelope');
    }
    return parseOutboxEnvelope(envelope, this.storageKey);
  }

  private async restoreRawState(rawValue: string | undefined): Promise<void> {
    if (rawValue === undefined) {
      await this.storage.remove(this.storageKey);
    } else {
      await this.storage.setString(this.storageKey, rawValue);
    }
  }

  private async writeState(state: AccountOutboxState): Promise<void> {
    const updatedAt = this.now();
    if (!Number.isFinite(updatedAt)) {
      throw new Error('Account outbox timestamp must be finite');
    }
    await this.storage.setString(
      this.storageKey,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        updatedAt,
        value: cloneState(state),
      }),
    );
  }

  private async removeSnapshotsBestEffort(keys: readonly string[]): Promise<void> {
    await Promise.all(
      keys.map(key => this.storage.remove(key).catch(() => undefined)),
    );
  }
}

function parseOutboxEnvelope(
  envelope: unknown,
  storageKey: string,
): AccountOutboxState {
  if (
    !isRecord(envelope) ||
    !hasExactKeys(envelope, ['schemaVersion', 'updatedAt', 'value']) ||
    envelope.schemaVersion !== SCHEMA_VERSION ||
    !isFiniteNumber(envelope.updatedAt) ||
    !isRecord(envelope.value) ||
    !hasExactKeys(envelope.value, ['items', 'conflicts']) ||
    !Array.isArray(envelope.value.items) ||
    !Array.isArray(envelope.value.conflicts)
  ) {
    throw new Error(`Malformed account outbox envelope for ${storageKey}`);
  }

  envelope.value.items.forEach(assertItem);
  envelope.value.conflicts.forEach(assertConflict);
  assertUniqueKeys(envelope.value.items, 'item');
  assertUniqueKeys(envelope.value.conflicts, 'conflict');
  return {
    items: envelope.value.items.map(cloneItem),
    conflicts: envelope.value.conflicts.map(cloneConflict),
  };
}

function emptyState(): AccountOutboxState {
  return {items: [], conflicts: []};
}

function assertItem(value: unknown): asserts value is AccountOutboxItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ITEM_KEYS) ||
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

function assertConflict(
  value: unknown,
): asserts value is AccountOutboxConflict {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, CONFLICT_KEYS) ||
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

function assertUniqueKeys(
  values: readonly (AccountOutboxItem | AccountOutboxConflict)[],
  label: string,
): void {
  const keys = new Set<string>();
  for (const value of values) {
    const key = operationKey(value.userId, value.operationId);
    if (keys.has(key)) {
      throw new Error(`Duplicate account outbox ${label}`);
    }
    keys.add(key);
  }
}

function sameImmutableOperation(
  left: AccountOutboxItem,
  right: AccountOutboxItem,
): boolean {
  return canonicalStringify({
    operationId: left.operationId,
    userId: left.userId,
    entityKind: left.entityKind,
    entityLocalId: left.entityLocalId,
    mutation: left.mutation,
    payload: left.payload,
    expectedRevision: left.expectedRevision,
    profileStorageKey: left.profileStorageKey,
    createdAt: left.createdAt,
  }) === canonicalStringify({
    operationId: right.operationId,
    userId: right.userId,
    entityKind: right.entityKind,
    entityLocalId: right.entityLocalId,
    mutation: right.mutation,
    payload: right.payload,
    expectedRevision: right.expectedRevision,
    profileStorageKey: right.profileStorageKey,
    createdAt: right.createdAt,
  });
}

function sameOperationKey(
  left: Pick<AccountOutboxItem, 'userId' | 'operationId'>,
  right: Pick<AccountOutboxItem, 'userId' | 'operationId'>,
): boolean {
  return left.userId === right.userId && left.operationId === right.operationId;
}

function sameEntity(
  left: Pick<AccountOutboxItem, 'userId' | 'entityKind' | 'entityLocalId'>,
  right: Pick<AccountOutboxItem, 'userId' | 'entityKind' | 'entityLocalId'>,
): boolean {
  return (
    left.userId === right.userId &&
    left.entityKind === right.entityKind &&
    left.entityLocalId === right.entityLocalId
  );
}

function operationKey(userId: string, operationId: string): string {
  return `${userId}\u0000${operationId}`;
}

function profileKeys(items: readonly AccountOutboxItem[]): string[] {
  return items.flatMap(item =>
    item.profileStorageKey === undefined ? [] : [item.profileStorageKey],
  );
}

function cloneState(state: AccountOutboxState): AccountOutboxState {
  return {
    items: state.items.map(cloneItem),
    conflicts: state.conflicts.map(cloneConflict),
  };
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

function withStorageMutationLock<T>(
  storageKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = storageMutationQueues.get(storageKey) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  storageMutationQueues.set(storageKey, tail);
  void tail.finally(() => {
    if (storageMutationQueues.get(storageKey) === tail) {
      storageMutationQueues.delete(storageKey);
    }
  });
  return result;
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalStringify(nested)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hasExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return (
    keys.length === expectedKeys.length &&
    keys.every(key => expectedKeys.includes(key))
  );
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(record).every(key => allowedKeys.includes(key));
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
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 1)
  );
}
