import {
  createAsyncStorageKeyValueStore,
  type PersistentKeyValueStore,
} from '../storage/persistent-key-value-store';
import {mobileStorageKeys} from '../storage/storage-keys';

export type WatchLogDeletionIdentity = {
  localSessionId: string;
  contentRevision?: string;
  artifactSha256?: string;
};

export type WatchLogDeletionTombstone = {
  schemaVersion: 1;
  localSessionId: string;
  requestedAt: number;
  sourceLocalIds: string[];
  expectedArtifact?: {
    contentRevision: string;
    artifactSha256: string;
  };
  watchAcknowledgedAt?: number;
};

export type WatchLogDeletionStore = {
  list(): Promise<WatchLogDeletionTombstone[]>;
  get(localSessionId: string): Promise<WatchLogDeletionTombstone | undefined>;
  record(
    input: WatchLogDeletionIdentity & {
      sourceLocalId: string;
      requestedAt: number;
    },
  ): Promise<WatchLogDeletionTombstone>;
  acknowledge(localSessionId: string, acknowledgedAt: number): Promise<void>;
};

export class WatchLogDeletionStorageError extends Error {
  constructor(message = 'Malformed Watch log deletion storage') {
    super(message);
    this.name = 'WatchLogDeletionStorageError';
  }
}

type StoredEnvelope = {
  schemaVersion: 1;
  tombstones: WatchLogDeletionTombstone[];
};

const SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const mutationTails = new Map<string, Promise<void>>();

export function createWatchLogDeletionStore(
  options: {
    storage?: PersistentKeyValueStore;
    key?: string;
  } = {},
): WatchLogDeletionStore {
  const storage = options.storage ?? createAsyncStorageKeyValueStore();
  const key = options.key ?? mobileStorageKeys.watchLogDeletions;

  const readUnlocked = async (): Promise<StoredEnvelope> => {
    const raw = await storage.getString(key);
    if (raw === undefined) {
      return {schemaVersion: SCHEMA_VERSION, tombstones: []};
    }
    return parseEnvelope(raw);
  };

  const writeUnlocked = async (envelope: StoredEnvelope): Promise<void> => {
    const normalized = normalizeEnvelope(envelope);
    await storage.setString(key, JSON.stringify(normalized));
    const readback = await readUnlocked();
    if (JSON.stringify(readback) !== JSON.stringify(normalized)) {
      throw new WatchLogDeletionStorageError('Watch deletion write readback mismatch');
    }
  };

  return {
    list: () =>
      serialize(key, async () => {
        const envelope = await readUnlocked();
        return envelope.tombstones.map(cloneTombstone);
      }),
    get: localSessionId =>
      serialize(key, async () => {
        assertNonEmptyString(localSessionId);
        const value = (await readUnlocked()).tombstones.find(
          tombstone => tombstone.localSessionId === localSessionId,
        );
        return value === undefined ? undefined : cloneTombstone(value);
      }),
    record: input =>
      serialize(key, async () => {
        const normalizedInput = normalizeRecordInput(input);
        const envelope = await readUnlocked();
        const index = envelope.tombstones.findIndex(
          value => value.localSessionId === normalizedInput.localSessionId,
        );
        const existing = index < 0 ? undefined : envelope.tombstones[index];
        const tombstone = mergeTombstone(existing, normalizedInput);
        if (index < 0) {
          envelope.tombstones.push(tombstone);
        } else {
          envelope.tombstones[index] = tombstone;
        }
        await writeUnlocked(envelope);
        return cloneTombstone(tombstone);
      }),
    acknowledge: (localSessionId, acknowledgedAt) =>
      serialize(key, async () => {
        assertNonEmptyString(localSessionId);
        assertTimestamp(acknowledgedAt);
        const envelope = await readUnlocked();
        const index = envelope.tombstones.findIndex(
          value => value.localSessionId === localSessionId,
        );
        if (index < 0) {
          return;
        }
        const currentAcknowledgedAt =
          envelope.tombstones[index]!.watchAcknowledgedAt;
        if (
          currentAcknowledgedAt !== undefined &&
          currentAcknowledgedAt >= acknowledgedAt
        ) {
          return;
        }
        envelope.tombstones[index] = {
          ...envelope.tombstones[index]!,
          watchAcknowledgedAt: acknowledgedAt,
        };
        await writeUnlocked(envelope);
      }),
  };
}

function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const preceding = mutationTails.get(key) ?? Promise.resolve();
  const result = preceding.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  mutationTails.set(key, tail);
  void tail.then(() => {
    if (mutationTails.get(key) === tail) {
      mutationTails.delete(key);
    }
  });
  return result;
}

function mergeTombstone(
  existing: WatchLogDeletionTombstone | undefined,
  input: ReturnType<typeof normalizeRecordInput>,
): WatchLogDeletionTombstone {
  const sourceLocalIds = [...new Set([
    ...(existing?.sourceLocalIds ?? []),
    input.sourceLocalId,
  ])].sort();
  const expectedArtifact =
    input.expectedArtifact ?? existing?.expectedArtifact;
  return {
    schemaVersion: SCHEMA_VERSION,
    localSessionId: input.localSessionId,
    requestedAt: Math.min(existing?.requestedAt ?? input.requestedAt, input.requestedAt),
    sourceLocalIds,
    ...(expectedArtifact === undefined ? {} : {expectedArtifact}),
    ...(existing?.watchAcknowledgedAt === undefined
      ? {}
      : {watchAcknowledgedAt: existing.watchAcknowledgedAt}),
  };
}

function normalizeRecordInput(
  input: WatchLogDeletionIdentity & {
    sourceLocalId: string;
    requestedAt: number;
  },
): {
  localSessionId: string;
  sourceLocalId: string;
  requestedAt: number;
  expectedArtifact?: WatchLogDeletionTombstone['expectedArtifact'];
} {
  assertNonEmptyString(input.localSessionId);
  assertNonEmptyString(input.sourceLocalId);
  assertTimestamp(input.requestedAt);
  const hasRevision = input.contentRevision !== undefined;
  const hasDigest = input.artifactSha256 !== undefined;
  if (hasRevision !== hasDigest) {
    throw new WatchLogDeletionStorageError('Incomplete Watch artifact identity');
  }
  if (
    input.contentRevision !== undefined &&
    input.artifactSha256 !== undefined
  ) {
    assertNonEmptyString(input.contentRevision);
    if (!SHA256_PATTERN.test(input.artifactSha256)) {
      throw new WatchLogDeletionStorageError('Invalid Watch artifact digest');
    }
  }
  return {
    localSessionId: input.localSessionId,
    sourceLocalId: input.sourceLocalId,
    requestedAt: input.requestedAt,
    ...(hasRevision && hasDigest
      ? {
          expectedArtifact: {
            contentRevision: input.contentRevision!,
            artifactSha256: input.artifactSha256!,
          },
        }
      : {}),
  };
}

function parseEnvelope(raw: string): StoredEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WatchLogDeletionStorageError();
  }
  if (!isPlainObject(parsed) || !hasExactKeys(parsed, ['schemaVersion', 'tombstones'])) {
    throw new WatchLogDeletionStorageError();
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.tombstones)) {
    throw new WatchLogDeletionStorageError();
  }
  return normalizeEnvelope({
    schemaVersion: SCHEMA_VERSION,
    tombstones: parsed.tombstones.map(parseTombstone),
  });
}

function normalizeEnvelope(envelope: StoredEnvelope): StoredEnvelope {
  if (envelope.schemaVersion !== SCHEMA_VERSION) {
    throw new WatchLogDeletionStorageError();
  }
  const seen = new Set<string>();
  const tombstones = envelope.tombstones.map(value => {
    const parsed = parseTombstone(value);
    if (seen.has(parsed.localSessionId)) {
      throw new WatchLogDeletionStorageError('Duplicate Watch deletion tombstone');
    }
    seen.add(parsed.localSessionId);
    return parsed;
  });
  tombstones.sort(
    (left, right) =>
      left.requestedAt - right.requestedAt ||
      left.localSessionId.localeCompare(right.localSessionId),
  );
  return {schemaVersion: SCHEMA_VERSION, tombstones};
}

function parseTombstone(value: unknown): WatchLogDeletionTombstone {
  if (
    !isPlainObject(value) ||
    !hasAllowedKeys(value, [
      'schemaVersion',
      'localSessionId',
      'requestedAt',
      'sourceLocalIds',
      'expectedArtifact',
      'watchAcknowledgedAt',
    ]) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.localSessionId !== 'string' ||
    typeof value.requestedAt !== 'number' ||
    !Array.isArray(value.sourceLocalIds)
  ) {
    throw new WatchLogDeletionStorageError();
  }
  assertNonEmptyString(value.localSessionId);
  assertTimestamp(value.requestedAt);
  if (
    value.sourceLocalIds.length === 0 ||
    !value.sourceLocalIds.every(sourceLocalId => typeof sourceLocalId === 'string')
  ) {
    throw new WatchLogDeletionStorageError();
  }
  const sourceLocalIds = [...new Set(value.sourceLocalIds)].sort();
  if (sourceLocalIds.length !== value.sourceLocalIds.length) {
    throw new WatchLogDeletionStorageError();
  }
  sourceLocalIds.forEach(assertNonEmptyString);
  const expectedArtifact = parseExpectedArtifact(value.expectedArtifact);
  if (value.watchAcknowledgedAt !== undefined) {
    if (typeof value.watchAcknowledgedAt !== 'number') {
      throw new WatchLogDeletionStorageError();
    }
    assertTimestamp(value.watchAcknowledgedAt);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    localSessionId: value.localSessionId,
    requestedAt: value.requestedAt,
    sourceLocalIds,
    ...(expectedArtifact === undefined ? {} : {expectedArtifact}),
    ...(value.watchAcknowledgedAt === undefined
      ? {}
      : {watchAcknowledgedAt: value.watchAcknowledgedAt}),
  };
}

function parseExpectedArtifact(
  value: unknown,
): WatchLogDeletionTombstone['expectedArtifact'] {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ['contentRevision', 'artifactSha256']) ||
    typeof value.contentRevision !== 'string' ||
    typeof value.artifactSha256 !== 'string'
  ) {
    throw new WatchLogDeletionStorageError();
  }
  assertNonEmptyString(value.contentRevision);
  if (!SHA256_PATTERN.test(value.artifactSha256)) {
    throw new WatchLogDeletionStorageError();
  }
  return {
    contentRevision: value.contentRevision,
    artifactSha256: value.artifactSha256,
  };
}

function assertNonEmptyString(value: string): void {
  if (value.length === 0 || value.length > 512) {
    throw new WatchLogDeletionStorageError();
  }
}

function assertTimestamp(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new WatchLogDeletionStorageError();
  }
}

function cloneTombstone(value: WatchLogDeletionTombstone): WatchLogDeletionTombstone {
  return {
    ...value,
    sourceLocalIds: [...value.sourceLocalIds],
    ...(value.expectedArtifact === undefined
      ? {}
      : {expectedArtifact: {...value.expectedArtifact}}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
