import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../types/dive-session';
import type {
  ConditionalDeleteResult,
  DeletePredicate,
} from './conditional-delete';

export type ImportWatchMessagesOptions = {
  artifactDigests?: Array<string | undefined>;
  assertCanCommit?: () => void;
};

export type DeleteDiveLogOptions = {
  assertCanCommit?: () => void;
  retainProfileAfterDelete?: boolean;
};

export type DiveLogRepository = {
  list(): Promise<DiveLogEntry[]>;
  get(localId: string): Promise<DiveLogEntry | undefined>;
  save(entry: DiveLogEntry): Promise<DiveLogEntry>;
  delete(localId: string, options?: DeleteDiveLogOptions): Promise<void>;
  deleteIf(
    localId: string,
    predicate: DeletePredicate<DiveLogEntry>,
    options?: DeleteDiveLogOptions,
  ): Promise<ConditionalDeleteResult>;
  removeWatchProfileIfUnreferenced(storageKey: string): Promise<void>;
  importWatchMessages(
    messages: WatchSyncMessage[],
    options?: ImportWatchMessagesOptions,
  ): Promise<DiveLogEntry[]>;
  getWatchProfile(localId: string): Promise<WatchDepthSample[]>;
};
