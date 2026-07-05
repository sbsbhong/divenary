import type {
  WatchDepthSample,
  WatchSession,
  WatchSessionCommon,
  WatchSyncMessage,
} from '../../../../packages/contracts/generated/typescript';

export type DiveLogbookSection = 'home' | 'logbook' | 'planning' | 'settings';

export type MobileDiveSession = WatchSessionCommon & {
  importKey: string;
  importedAt: number;
  mediaPlaceholders: string[];
};

export type DivePlanningItem = {
  id: string;
  label: string;
  completed: boolean;
};

export type DiveSessionSummary = {
  durationSeconds?: number;
  maxDepthMeters?: number;
  averageDepthMeters?: number;
  waterTemperatureCelsius?: number;
  sampleCount: number;
};

export type DiveSessionFilter = {
  query: string;
  tag?: string;
};

export type { WatchDepthSample, WatchSession, WatchSessionCommon, WatchSyncMessage };
