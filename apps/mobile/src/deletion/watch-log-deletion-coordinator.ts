import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils';

import type {WatchSessionDeletionCommand} from '../native/watch-connectivity';
import type {DiveLogRepository} from '../repositories/dive-log-repository';
import type {DiveLogEntry} from '../types/dive-log-entry';
import type {
  WatchLogDeletionStore,
  WatchLogDeletionTombstone,
} from './watch-log-deletion-store';

export type {WatchSessionDeletionCommand} from '../native/watch-connectivity';

export type WatchLogDeletionCoordinator = {
  delete(entry: DiveLogEntry): Promise<void>;
  reconcile(): Promise<void>;
  isDeleted(localSessionId: string): Promise<boolean>;
};

export class WatchLogDeletedError extends Error {
  constructor() {
    super('Cannot restore a deleted Watch session');
    this.name = 'WatchLogDeletedError';
  }
}

type WatchLogDeletionCoordinatorOptions = {
  tombstones: WatchLogDeletionStore;
  repository: DiveLogRepository;
  queueDeletion(command: WatchSessionDeletionCommand): Promise<void>;
  beforeDelete?(tombstone: WatchLogDeletionTombstone): Promise<void>;
  requestSync?(): Promise<unknown>;
  now?: () => number;
  warn?: (message: string, error: unknown) => void;
};

export function createWatchLogDeletionCoordinator(
  options: WatchLogDeletionCoordinatorOptions,
): WatchLogDeletionCoordinator {
  const now = options.now ?? (() => Date.now() / 1_000);
  const warn =
    options.warn ??
    ((message: string, error: unknown) => {
      console.warn(message, error);
    });

  const queueSafely = async (
    tombstone: WatchLogDeletionTombstone,
  ): Promise<void> => {
    if (tombstone.watchAcknowledgedAt !== undefined) {
      return;
    }
    try {
      await options.queueDeletion(commandFromTombstone(tombstone));
    } catch (error) {
      warn('Failed to queue Watch session deletion', error);
    }
  };

  const requestSyncSafely = async (): Promise<void> => {
    if (!options.requestSync) {
      return;
    }
    try {
      await options.requestSync();
    } catch (error) {
      warn('Failed to schedule account sync after Watch log deletion', error);
    }
  };

  return {
    async delete(entry) {
      const capture = entry.watchCapture;
      if (capture === undefined) {
        await options.repository.delete(entry.localId);
        await requestSyncSafely();
        return;
      }
      const profile = capture.profile;
      const artifactSha256 = profile?.artifactSha256 ?? profile?.sha256;
      const hasCompleteArtifact =
        profile?.contentRevision !== undefined &&
        artifactSha256 !== undefined;
      const tombstone = await options.tombstones.record({
        localSessionId: capture.session.localSessionId,
        sourceLocalId: entry.localId,
        requestedAt: now(),
        ...(hasCompleteArtifact
          ? {
              contentRevision: profile.contentRevision,
              artifactSha256,
            }
          : {}),
      });
      await options.beforeDelete?.(tombstone);
      await options.repository.delete(entry.localId);
      await queueSafely(tombstone);
      await requestSyncSafely();
    },
    async reconcile() {
      let deletedRow = false;
      for (const tombstone of await options.tombstones.list()) {
        await options.beforeDelete?.(tombstone);
        for (const localId of tombstone.sourceLocalIds) {
          if ((await options.repository.get(localId)) === undefined) {
            continue;
          }
          await options.repository.delete(localId);
          deletedRow = true;
        }
        await queueSafely(tombstone);
      }
      if (deletedRow) {
        await requestSyncSafely();
      }
    },
    async isDeleted(localSessionId) {
      return (await options.tombstones.get(localSessionId)) !== undefined;
    },
  };
}

export function createWatchDeletionAwareLogbookRepository(options: {
  repository: DiveLogRepository;
  tombstones: WatchLogDeletionStore;
  deleteEntry(entry: DiveLogEntry): Promise<void>;
}): DiveLogRepository {
  const isEntryDeleted = async (entry: DiveLogEntry): Promise<boolean> => {
    const localSessionId = entry.watchCapture?.session.localSessionId;
    return (
      localSessionId !== undefined &&
      (await options.tombstones.get(localSessionId)) !== undefined
    );
  };
  const filterDeleted = async (
    entries: DiveLogEntry[],
  ): Promise<DiveLogEntry[]> => {
    const deletedSessionIds = new Set(
      (await options.tombstones.list()).map(value => value.localSessionId),
    );
    return entries.filter(entry => {
      const localSessionId = entry.watchCapture?.session.localSessionId;
      return localSessionId === undefined || !deletedSessionIds.has(localSessionId);
    });
  };
  const repository: DiveLogRepository = {
    list: async () => filterDeleted(await options.repository.list()),
    async get(localId) {
      const entry = await options.repository.get(localId);
      return entry === undefined || (await isEntryDeleted(entry))
        ? undefined
        : entry;
    },
    async save(entry) {
      if (await isEntryDeleted(entry)) {
        throw new WatchLogDeletedError();
      }
      return options.repository.save(entry);
    },
    async delete(localId, deleteOptions) {
      const entry = await options.repository.get(localId);
      if (entry === undefined) {
        await options.repository.delete(localId, deleteOptions);
        return;
      }
      await options.deleteEntry(entry);
    },
    deleteIf: (localId, predicate, deleteOptions) =>
      options.repository.deleteIf(localId, predicate, deleteOptions),
    removeWatchProfileIfUnreferenced: storageKey =>
      options.repository.removeWatchProfileIfUnreferenced(storageKey),
    async importWatchMessages(messages, importOptions) {
      const deletedSessionIds = new Set(
        (await options.tombstones.list()).map(value => value.localSessionId),
      );
      const accepted = messages.filter(
        message => !deletedSessionIds.has(message.session.localSessionId),
      );
      if (accepted.length === 0) {
        return filterDeleted(await options.repository.list());
      }
      return filterDeleted(
        await options.repository.importWatchMessages(accepted, {
          ...importOptions,
          ...(importOptions?.artifactDigests === undefined
            ? {}
            : {
                artifactDigests: importOptions.artifactDigests.filter(
                  (_value, index) =>
                    !deletedSessionIds.has(
                      messages[index]!.session.localSessionId,
                    ),
                ),
              }),
          ...(importOptions?.preparedProfiles === undefined
            ? {}
            : {
                preparedProfiles: importOptions.preparedProfiles.filter(
                  (_value, index) =>
                    !deletedSessionIds.has(
                      messages[index]!.session.localSessionId,
                    ),
                ),
              }),
        }),
      );
    },
    async getWatchProfile(localId) {
      const entry = await options.repository.get(localId);
      if (entry !== undefined && (await isEntryDeleted(entry))) {
        return [];
      }
      return options.repository.getWatchProfile(localId);
    },
    async readStoredWatchProfile(localId) {
      const entry = await options.repository.get(localId);
      if (entry !== undefined && (await isEntryDeleted(entry))) {
        return undefined;
      }
      return options.repository.readStoredWatchProfile(localId);
    },
  };
  if (options.repository.deleteManyIf !== undefined) {
    repository.deleteManyIf = (requests, deleteOptions) =>
      options.repository.deleteManyIf!(requests, deleteOptions);
  }
  for (const method of ['saveLocalOnly', 'enqueueSaved', 'reconcileSaved'] as const) {
    const candidate = Reflect.get(options.repository, method);
    if (typeof candidate === 'function') {
      Reflect.set(repository, method, candidate.bind(options.repository));
    }
  }
  return repository;
}

function commandFromTombstone(
  tombstone: WatchLogDeletionTombstone,
): WatchSessionDeletionCommand {
  const identity = {
    formatVersion: 1 as const,
    localSessionId: tombstone.localSessionId,
    requestedAt: tombstone.requestedAt,
    ...(tombstone.expectedArtifact === undefined
      ? {}
      : {
          contentRevision: tombstone.expectedArtifact.contentRevision,
          artifactSha256: tombstone.expectedArtifact.artifactSha256,
        }),
  };
  return {
    ...identity,
    commandId: bytesToHex(sha256(utf8ToBytes(JSON.stringify(identity)))),
  };
}
