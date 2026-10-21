import { createAsyncStorageKeyValueStore, type PersistentKeyValueStore } from './persistent-key-value-store';
import { mobileStorageKeys } from './storage-keys';

export type WatchPayloadRejectionReason = 'invalidMessage' | 'invalidPreparedPayload' | 'repeatedImportFailure';

/**
 * Device-local record of a watch recording the phone set aside. It stores identifiers and a reason
 * only, never dive content, so Settings can explain why a recording has not appeared.
 */
export type RejectedWatchPayload = {
  payloadId?: string;
  localSessionId?: string;
  reason: WatchPayloadRejectionReason;
  rejectedAt: number;
};

export type WatchRejectedPayloadStore = {
  recordRejection(rejection: Omit<RejectedWatchPayload, 'rejectedAt'>): Promise<void>;
  /** Returns the consecutive failure count for the payload, including this failure. */
  recordImportFailure(payloadKey: string): Promise<number>;
  clearImportFailures(payloadKey: string): Promise<void>;
  list(): Promise<RejectedWatchPayload[]>;
  clear(): Promise<void>;
  subscribe(listener: () => void): () => void;
};

const MAX_REJECTIONS = 20;

export function createWatchRejectedPayloadStore(options: {
  storage: PersistentKeyValueStore;
  now?: () => number;
}): WatchRejectedPayloadStore {
  const { storage } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());

  const readJson = async <T>(key: string, isValid: (value: unknown) => value is T, fallback: T): Promise<T> => {
    try {
      const raw = await storage.getString(key);
      if (raw === undefined) {
        return fallback;
      }
      const parsed: unknown = JSON.parse(raw);
      return isValid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  };

  const listRejections = () => readJson(mobileStorageKeys.watchRejectedPayloads, isRejectionList, []);
  const readFailureCounts = () => readJson(mobileStorageKeys.watchImportFailures, isFailureCounts, {});

  return {
    async recordRejection(rejection) {
      const identity = rejection.localSessionId ?? rejection.payloadId;
      const existing = await listRejections();
      const next = [
        { ...rejection, rejectedAt: now() },
        ...existing.filter(entry => identity === undefined || (entry.localSessionId ?? entry.payloadId) !== identity),
      ].slice(0, MAX_REJECTIONS);
      await storage.setString(mobileStorageKeys.watchRejectedPayloads, JSON.stringify(next));
      notify();
    },
    async recordImportFailure(payloadKey) {
      const counts = await readFailureCounts();
      const nextCount = (counts[payloadKey] ?? 0) + 1;
      await storage.setString(mobileStorageKeys.watchImportFailures, JSON.stringify({ ...counts, [payloadKey]: nextCount }));
      return nextCount;
    },
    async clearImportFailures(payloadKey) {
      const counts = await readFailureCounts();
      if (counts[payloadKey] === undefined) {
        return;
      }
      const { [payloadKey]: _cleared, ...remaining } = counts;
      await storage.setString(mobileStorageKeys.watchImportFailures, JSON.stringify(remaining));
    },
    list: listRejections,
    async clear() {
      await storage.remove(mobileStorageKeys.watchRejectedPayloads);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function isRejectionList(value: unknown): value is RejectedWatchPayload[] {
  return (
    Array.isArray(value) &&
    value.every(
      entry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RejectedWatchPayload).reason === 'string' &&
        typeof (entry as RejectedWatchPayload).rejectedAt === 'number',
    )
  );
}

function isFailureCounts(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(count => typeof count === 'number')
  );
}

export const defaultWatchRejectedPayloadStore = createWatchRejectedPayloadStore({
  storage: createAsyncStorageKeyValueStore(),
});
