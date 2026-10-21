import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { PersistentKeyValueStore } from './persistent-key-value-store';

export type StoredEnvelope<T> = {
  schemaVersion: number;
  updatedAt: number;
  value: T;
};

/**
 * `pending` and `commit` are the write-journal keys older builds used; they are only read to
 * finish a journal left behind. Unreadable stored text is copied under `quarantinePrefix`.
 */
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

/**
 * Stores one JSON value under one key. The key-value store replaces a single key atomically
 * (AsyncStorage keeps it in one SQLite row), so a write is one `setString` plus a readback.
 *
 * Reading parses and migrates the stored text once and reuses that value until the text changes.
 * `read()` can therefore return the same object to several callers: treat it as read-only and
 * copy it before changing it.
 */
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
  private legacyJournalSettled = false;
  private cached?: {raw: string; value: T};

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
    await this.settleLegacyJournal();
    const rawValue = await this.storage.getString(this.key);

    if (rawValue === undefined) {
      this.cached = undefined;
      return this.defaultValue();
    }
    if (this.cached?.raw === rawValue) {
      return this.cached.value;
    }

    try {
      const envelope = JSON.parse(rawValue) as StoredEnvelope<unknown>;
      const value = this.migrate(envelope);
      this.cached = {raw: rawValue, value};
      return value;
    } catch (error) {
      this.cached = undefined;
      return this.handleReadError(rawValue, error);
    }
  }

  /**
   * A failed `setString` leaves the previous value in place. A readback failure after it means
   * the new value may already be stored, so it is reported as {@link PersistentJsonCommittedWriteError}.
   */
  async write(value: T): Promise<void> {
    await this.settleLegacyJournal();
    const envelope: StoredEnvelope<T> = {
      schemaVersion: this.schemaVersion,
      updatedAt: this.now(),
      value,
    };

    const serialized = JSON.stringify(envelope);
    this.cached = undefined;
    await this.storage.setString(this.key, serialized);
    let stored: string | undefined;
    try {
      stored = await this.storage.getString(this.key);
    } catch (error) {
      throw new PersistentJsonCommittedWriteError(this.key, toError(error));
    }
    if (stored !== serialized) {
      throw new PersistentJsonCommittedWriteError(
        this.key,
        new PersistentJsonRecoveryError(this.key, 'Main write readback failed'),
      );
    }
  }

  async remove(): Promise<void> {
    this.cached = undefined;
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

  /**
   * Older builds wrote each value to a pending key and a commit marker before the main key. A
   * crash between those steps can leave a journal behind, so it is finished (or a never-committed
   * pending value discarded) once before this store first reads or writes.
   */
  private async settleLegacyJournal(): Promise<void> {
    if (!this.recoveryKeys || this.legacyJournalSettled) {
      return;
    }
    if ((await this.storage.getString(this.recoveryKeys.commit)) !== undefined) {
      await this.recoverCommittedWrite(this.recoveryKeys);
    } else if (
      (await this.storage.getString(this.recoveryKeys.pending)) !== undefined
    ) {
      await this.storage.remove(this.recoveryKeys.pending);
    }
    this.legacyJournalSettled = true;
  }

  private async recoverCommittedWrite(
    recoveryKeys: PersistentJsonRecoveryKeys,
  ): Promise<void> {
    const markerRaw = await this.storage.getString(recoveryKeys.commit);
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
    const pending = await this.storage.getString(recoveryKeys.pending);
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
    await this.clearLegacyJournal(recoveryKeys);
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

  private async clearLegacyJournal(
    recoveryKeys: PersistentJsonRecoveryKeys,
  ): Promise<void> {
    await this.storage.remove(recoveryKeys.commit);
    if ((await this.storage.getString(recoveryKeys.commit)) !== undefined) {
      throw new PersistentJsonRecoveryError(
        this.key,
        `Failed JSON commit cleanup for ${this.key}`,
      );
    }
    await this.storage.remove(recoveryKeys.pending);
    if ((await this.storage.getString(recoveryKeys.pending)) !== undefined) {
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
