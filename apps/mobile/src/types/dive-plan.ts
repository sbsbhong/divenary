import type { WatchSession } from './dive-session';
import type { CloudSyncStatus, DivePressureValues } from './dive-log-entry';

export type DivePlanStatus = 'draft' | 'planned' | 'completed';
export type DiveEntryStyle = 'shore' | 'boat' | 'pool';

export type DivePlanSite = {
  siteId?: string;
  name?: string;
};

export type DivePlanValues = {
  plannedMaxDepthMeters?: number;
  plannedDurationMinutes?: number;
  gasLabel?: string;
  waterCondition?: WatchSession['waterCondition'];
  visibilityExpectation?: number;
  perceivedDifficulty?: number;
  trainingFocus?: string;
  repetitionTarget?: number;
  poolLengthMeters?: number;
  lapTarget?: number;
  plannedPressure?: DivePressureValues;
};

export type DivePlanChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
};

export type DivePlan = {
  localId: string;
  remoteId?: string;
  ownerUserId?: string;
  cloudSyncStatus?: CloudSyncStatus;
  status: DivePlanStatus;
  createdAt: number;
  updatedAt: number;
  plannedAt?: number;
  completedAt?: number;
  convertedLogLocalId?: string;
  title?: string;
  diveMode?: WatchSession['diveMode'];
  entryStyle?: DiveEntryStyle;
  site: DivePlanSite;
  buddyIds: string[];
  gearIds: string[];
  tags: string[];
  objective?: string;
  notes?: string;
  plannedValues: DivePlanValues;
  checklistItems: DivePlanChecklistItem[];
};
