import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { PersistentKeyValueStore } from './persistent-key-value-store';

export type StoredEnvelope<T> = {
  schemaVersion: number;
  updatedAt: number;
  value: T;
};

export type PersistentJsonRecoveryKeys = {
  pending: string;
  commit: string;
  quarantinePrefix: string;
};

export type PersistentJsonStoreOptions<T> = {
  key: string;
  schemaVersion: number;
  defaultValue: () => T;
  migrate: (envelope: StoredEnvelope<unknown>) => T;
  storage: PersistentKeyValueStore;
  now?: () => number;
  onReadError?: (error: Error) => void;
  readFailurePolicy?: 'default' | 'throw';
  recoveryKeys?: PersistentJsonRecoveryKeys;
};

export class UnsupportedStorageVersionError extends Error {
  constructor(key: string, schemaVersion: number) {
    super(`Unsupported storage schema version ${schemaVersion} for ${key}`);
    this.name = 'UnsupportedStorageVersionError';
  }
}

export class PersistentJsonReadError extends Error {
  constructor(
    readonly key: string,
    readonly cause: Error,
  ) {
    super(`Failed to read durable JSON for ${key}`);
    this.name = 'PersistentJsonReadError';
  }
}

export class PersistentJsonRecoveryError extends Error {
  constructor(readonly key: string, message: string) {
    super(message);
    this.name = 'PersistentJsonRecoveryError';
  }
}

export class PersistentJsonCommittedWriteError extends Error {
  constructor(
    readonly key: string,
    readonly cause: Error,
  ) {
    super(
      `Durable JSON write for ${key} crossed its commit boundary: ${cause.message}`,
    );
    this.name = 'PersistentJsonCommittedWriteError';
  }
}

type JournalMarker = {
  schemaVersion: 1;
  digest: string;
  byteCount: number;
};

export class PersistentJsonStore<T> {
  private readonly key: string;
  private readonly schemaVersion: number;
  private readonly defaultValue: () => T;
  private readonly migrate: (envelope: StoredEnvelope<unknown>) => T;
  private readonly storage: PersistentKeyValueStore;
  private readonly now: () => number;
  private readonly onReadError?: (error: Error) => void;
  private readonly readFailurePolicy: 'default' | 'throw';
  private readonly recoveryKeys?: PersistentJsonRecoveryKeys;

  constructor(options: PersistentJsonStoreOptions<T>) {
    this.key = options.key;
    this.schemaVersion = options.schemaVersion;
    this.defaultValue = options.defaultValue;
    this.migrate = options.migrate;
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now() / 1000);
    this.onReadError = options.onReadError;
    this.readFailurePolicy = options.readFailurePolicy ?? 'default';
    this.recoveryKeys = options.recoveryKeys;
  }

  async read(): Promise<T> {
    await this.recoverCommittedWrite();
    const rawValue = await this.storage.getString(this.key);

    if (rawValue === undefined) {
      return this.defaultValue();
    }

    try {
      const envelope = JSON.parse(rawValue) as StoredEnvelope<unknown>;
      return this.migrate(envelope);
    } catch (error) {
      return this.handleReadError(rawValue, error);
    }
  }

  async write(value: T): Promise<void> {
    const envelope: StoredEnvelope<T> = {
      schemaVersion: this.schemaVersion,
      updatedAt: this.now(),
      value,
    };

    const serialized = JSON.stringify(envelope);
    if (!this.recoveryKeys) {
      await this.storage.setString(this.key, serialized);
      return;
    }
    await this.storage.setString(this.recoveryKeys.pending, serialized);
    if ((await this.storage.getString(this.recoveryKeys.pending)) !== serialized) {
      throw new PersistentJsonRecoveryError(
        this.key,
        'Pending write readback failed',
      );
    }
    const markerRaw = JSON.stringify({
      schemaVersion: 1,
      digest: digest(serialized),
      byteCount: byteCount(serialized),
    } satisfies JournalMarker);
    try {
      await this.storage.setString(this.recoveryKeys.commit, markerRaw);
      if (
        (await this.storage.getString(this.recoveryKeys.commit)) !== markerRaw
      ) {
        throw new PersistentJsonRecoveryError(
          this.key,
          'Commit marker readback failed',
        );
      }
    } catch (error) {
      await this.handleUnverifiedCommit(error);
    }
    try {
      await this.storage.setString(this.key, serialized);
      if ((await this.storage.getString(this.key)) !== serialized) {
        throw new PersistentJsonRecoveryError(
          this.key,
          'Main write readback failed',
        );
      }
      await this.clearRecoveryJournal();
    } catch (error) {
      try {
        await this.recoverCommittedWrite();
        if ((await this.storage.getString(this.key)) !== serialized) {
          throw new PersistentJsonRecoveryError(
            this.key,
            'Committed main write verification failed',
          );
        }
        await this.clearRecoveryJournal();
      } catch (recoveryError) {
        throw new PersistentJsonCommittedWriteError(
          this.key,
          toError(recoveryError),
        );
      }
    }
  }

  async remove(): Promise<void> {
    if (this.recoveryKeys) {
      await this.storage.remove(this.recoveryKeys.commit);
      if (
        (await this.storage.getString(this.recoveryKeys.commit)) !== undefined
      ) {
        throw new PersistentJsonRecoveryError(
          this.key,
          `Failed JSON journal removal for ${this.key}`,
        );
      }
    }
    await this.storage.remove(this.key);
    if ((await this.storage.getString(this.key)) !== undefined) {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Failed durable JSON removal for ${this.key}`,
      );
    }
    if (this.recoveryKeys) {
      await this.storage.remove(this.recoveryKeys.pending);
      if (
        (await this.storage.getString(this.recoveryKeys.pending)) !== undefined
      ) {
        throw new PersistentJsonRecoveryError(
          this.key,
          `Failed pending JSON journal removal for ${this.key}`,
        );
      }
    }
  }

  private async recoverCommittedWrite(): Promise<void> {
    if (!this.recoveryKeys) {
      return;
    }
    const markerRaw = await this.storage.getString(this.recoveryKeys.commit);
    if (markerRaw === undefined) {
      return;
    }
    let marker: JournalMarker;
    try {
      marker = parseJournalMarker(markerRaw);
    } catch {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Invalid committed JSON journal for ${this.key}`,
      );
    }
    const pending = await this.storage.getString(this.recoveryKeys.pending);
    if (
      pending === undefined ||
      byteCount(pending) !== marker.byteCount ||
      digest(pending) !== marker.digest
    ) {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Invalid committed JSON journal for ${this.key}`,
      );
    }
    await this.storage.setString(this.key, pending);
    if ((await this.storage.getString(this.key)) !== pending) {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Failed JSON journal readback for ${this.key}`,
      );
    }
    await this.clearRecoveryJournal();
  }

  private async handleReadError(raw: string, error: unknown): Promise<T> {
    const cause = toError(error);
    this.onReadError?.(cause);
    if (this.readFailurePolicy !== 'throw') {
      return this.defaultValue();
    }
    if (this.recoveryKeys) {
      const quarantineKey = `${this.recoveryKeys.quarantinePrefix}${digest(raw)}`;
      if ((await this.storage.getString(quarantineKey)) === undefined) {
        await this.storage.setString(quarantineKey, raw);
      }
      if ((await this.storage.getString(quarantineKey)) !== raw) {
        throw new PersistentJsonRecoveryError(
          this.key,
          `Failed JSON quarantine readback for ${this.key}`,
        );
      }
    }
    throw new PersistentJsonReadError(this.key, cause);
  }

  private async handleUnverifiedCommit(error: unknown): Promise<never> {
    if (!this.recoveryKeys) {
      throw toError(error);
    }
    try {
      await this.storage.remove(this.recoveryKeys.commit);
      if (
        (await this.storage.getString(this.recoveryKeys.commit)) !== undefined
      ) {
        throw new PersistentJsonRecoveryError(
          this.key,
          `Failed to invalidate JSON commit marker for ${this.key}`,
        );
      }
    } catch (invalidationError) {
      throw new PersistentJsonCommittedWriteError(
        this.key,
        toError(invalidationError),
      );
    }
    throw toError(error);
  }

  private async clearRecoveryJournal(): Promise<void> {
    if (!this.recoveryKeys) {
      return;
    }
    await this.storage.remove(this.recoveryKeys.commit);
    if (
      (await this.storage.getString(this.recoveryKeys.commit)) !== undefined
    ) {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Failed JSON commit cleanup for ${this.key}`,
      );
    }
    await this.storage.remove(this.recoveryKeys.pending);
    if (
      (await this.storage.getString(this.recoveryKeys.pending)) !== undefined
    ) {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Failed JSON pending cleanup for ${this.key}`,
      );
    }
  }
}

export function migrateVersionedValue<T>(key: string, schemaVersion: number, envelope: StoredEnvelope<unknown>): T {
  if (envelope.schemaVersion !== schemaVersion) {
    throw new UnsupportedStorageVersionError(key, Number(envelope.schemaVersion));
  }

  return envelope.value as T;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function digest(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value)));
}

function byteCount(value: string): number {
  return utf8ToBytes(value).length;
}

function parseJournalMarker(raw: string): JournalMarker {
  const value = JSON.parse(raw) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as {schemaVersion?: unknown}).schemaVersion !== 1 ||
    typeof (value as {digest?: unknown}).digest !== 'string' ||
    !Number.isSafeInteger((value as {byteCount?: unknown}).byteCount) ||
    ((value as {byteCount: number}).byteCount < 0)
  ) {
    throw new Error('Invalid JSON journal marker');
  }
  return value as JournalMarker;
}
