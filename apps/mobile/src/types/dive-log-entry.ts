import type { WatchDepthSample, WatchSession, WatchSessionCommon } from './dive-session';
import type { DiveEntryStyle } from './dive-plan';

export type DiveLogSource = 'manual' | 'watch';
export type DiveFieldSource = 'manual' | 'mobile' | 'watch';
export type CloudSyncStatus = 'notConfigured' | 'pending' | 'synced' | 'failed';
export type DivePressureUnit = 'bar' | 'psi';

export type DivePressureValues = {
  unit?: DivePressureUnit;
  start?: number;
  end?: number;
};

export type DiveLogSite = {
  siteId?: string;
  name?: string;
};

export type DiveLogManualMeasuredValues = {
  startedAt?: number;
  endedAt?: number;
  durationSeconds?: number;
  maxDepthMeters?: number;
  averageDepthMeters?: number;
  waterTemperatureCelsius?: number;
  diveMode?: WatchSession['diveMode'];
  gasLabel?: string;
  perceivedExertion?: number;
  visibilityRating?: number;
  waterCondition?: WatchSession['waterCondition'];
  repetitionCount?: number;
  trainingFocus?: string;
  poolLengthMeters?: number;
  lapCount?: number;
  pressure?: DivePressureValues;
};

export type DiveLogManualFields = {
  title?: string;
  site: DiveLogSite;
  entryStyle?: DiveEntryStyle;
  buddyIds: string[];
  gearIds: string[];
  tags: string[];
  observedMarineLife: string[];
  notes?: string;
  rating?: number;
  measuredValues: DiveLogManualMeasuredValues;
};

export type DiveLogMobileFields = {
  mediaPlaceholders: string[];
};

export type DiveLogWatchMeasuredValues = {
  startedAt: number;
  endedAt?: number;
  durationSeconds?: number;
  maxDepthMeters?: number;
  averageDepthMeters?: number;
  waterTemperatureCelsius?: number;
};

export type DiveLogWatchCapture = {
  importKey: string;
  importedAt: number;
  session: WatchSessionCommon;
  measuredValues: DiveLogWatchMeasuredValues;
  samples: WatchDepthSample[];
  profile?: {
    storageKey: string;
    contentRevision: string;
    sampleCount: number;
    sha256?: string;
  };
};

export type DiveLogFieldProvenance = Partial<
  Record<
    | 'site'
    | 'buddyIds'
    | 'gearIds'
    | 'tags'
    | 'observedMarineLife'
    | 'notes'
    | 'rating'
    | 'measuredValues'
    | 'mediaPlaceholders'
    | 'startedAt'
    | 'endedAt'
    | 'durationSeconds'
    | 'maxDepthMeters'
    | 'averageDepthMeters'
    | 'waterTemperatureCelsius'
    | 'gasLabel'
    | 'perceivedExertion'
    | 'visibilityRating'
    | 'waterCondition'
    | 'repetitionCount'
    | 'trainingFocus'
    | 'poolLengthMeters'
    | 'lapCount'
    | 'pressure'
    | 'depthSamples',
    DiveFieldSource
  >
>;

export type DiveLogEntry = {
  localId: string;
  remoteId?: string;
  ownerUserId?: string;
  source: DiveLogSource;
  cloudSyncStatus: CloudSyncStatus;
  createdAt: number;
  updatedAt: number;
  manual: DiveLogManualFields;
  mobile: DiveLogMobileFields;
  watchCapture?: DiveLogWatchCapture;
  provenance: DiveLogFieldProvenance;
};
