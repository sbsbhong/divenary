import type { DiveLogEntry } from '../types/dive-log-entry';
import type { WatchDepthSample, WatchSyncMessage } from '../types/dive-session';

export type DiveLogRepository = {
  list(): Promise<DiveLogEntry[]>;
  get(localId: string): Promise<DiveLogEntry | undefined>;
  save(entry: DiveLogEntry): Promise<DiveLogEntry>;
  delete(localId: string): Promise<void>;
  importWatchMessages(messages: WatchSyncMessage[]): Promise<DiveLogEntry[]>;
  getWatchProfile(localId: string): Promise<WatchDepthSample[]>;
};
