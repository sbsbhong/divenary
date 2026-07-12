import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { DivePlan } from '../types/dive-plan';
import { buildPlanNotes } from '../utils/dive-plan-to-log-entry';

export const WATCH_CONNECTIVITY_PAYLOAD_EVENT = 'DiveWatchSyncPayloadReceived';

export type WatchConnectivityPayload = {
  payloadId?: string;
  payloadJson: string;
  localSessionId?: string;
  receivedAt?: number;
  contentRevision?: string;
  sha256?: string;
};

export type WatchConnectivitySubscription = {
  remove(): void;
};

export type LinkedWatchInfo = {
  nativeBridgeAvailable?: boolean;
  isSupported: boolean;
  isPaired: boolean;
  isWatchAppInstalled: boolean;
  isReachable: boolean;
  name?: string;
};

export type PlannedWatchDivesUpdateStatus = LinkedWatchInfo & {
  activationState: 'notActivated' | 'inactive' | 'activated' | 'unknown' | 'unsupported';
  payloadCount: number;
  queuedCount: number;
  lastContextErrorCode?: number;
  lastContextErrorDescription?: string;
  lastContextErrorDomain?: string;
  updatedAt?: number;
};

type WatchConnectivityModule = {
  drainPendingPayloads?: () => Promise<WatchConnectivityPayload[]>;
  acknowledgePayloads?: (payloadIds: string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: string[]) => Promise<void>;
  updatePlannedDives?: (plannedDivesJson: string) => Promise<PlannedWatchDivesUpdateStatus | undefined>;
  getLinkedWatchInfo?: () => Promise<LinkedWatchInfo>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

type WatchPlannedDivePayload = {
  localId: string;
  title?: string;
  siteName?: string;
  diveMode?: DivePlan['diveMode'];
  entryStyle?: DivePlan['entryStyle'];
  plannedAt?: number;
  plannedMaxDepthMeters?: number;
  plannedDurationMinutes?: number;
  gasLabel?: string;
  buddyIds: string[];
  gearIds: string[];
  tags: string[];
  notes?: string;
};

const nativeModule =
  Platform.OS === 'ios'
    ? (NativeModules.WatchConnectivityModule as WatchConnectivityModule | undefined)
    : undefined;

export function isWatchConnectivityAvailable(): boolean {
  return Boolean(nativeModule?.drainPendingPayloads);
}

export async function drainPendingWatchConnectivityPayloads(): Promise<WatchConnectivityPayload[]> {
  if (!nativeModule?.drainPendingPayloads) {
    return [];
  }

  return nativeModule.drainPendingPayloads();
}

export async function acknowledgeWatchConnectivityPayloads(payloadIds: readonly string[]): Promise<void> {
  if (!nativeModule?.acknowledgePayloads || payloadIds.length === 0) {
    return;
  }

  await nativeModule.acknowledgePayloads([...payloadIds]);
}

export async function acknowledgeImportedWatchConnectivityPayloads(payloadIds: readonly string[]): Promise<void> {
  if (!nativeModule?.acknowledgeImportedPayloads || payloadIds.length === 0) {
    return;
  }

  await nativeModule.acknowledgeImportedPayloads([...payloadIds]);
}

export async function updatePlannedWatchDives(plans: readonly DivePlan[]): Promise<PlannedWatchDivesUpdateStatus> {
  const plannedDives = plans.filter(isWatchVisiblePlan).map(toWatchPlannedDivePayload);

  if (!nativeModule?.updatePlannedDives) {
    return makeUnavailablePlannedDivesStatus(plannedDives.length);
  }

  const status = await nativeModule.updatePlannedDives(JSON.stringify(plannedDives));

  return {
    ...makeUnavailablePlannedDivesStatus(plannedDives.length),
    nativeBridgeAvailable: true,
    ...status,
    payloadCount: status?.payloadCount ?? plannedDives.length,
  };
}

export async function getLinkedWatchInfo(): Promise<LinkedWatchInfo> {
  if (!nativeModule?.getLinkedWatchInfo) {
    return {
      nativeBridgeAvailable: false,
      isSupported: false,
      isPaired: false,
      isWatchAppInstalled: false,
      isReachable: false,
    };
  }

  return nativeModule.getLinkedWatchInfo();
}

export function subscribeToWatchConnectivityPayloads(
  handler: (payload: WatchConnectivityPayload) => void,
): WatchConnectivitySubscription {
  if (!nativeModule) {
    return { remove() {} };
  }

  const emitter = new NativeEventEmitter(nativeModule);
  return emitter.addListener(WATCH_CONNECTIVITY_PAYLOAD_EVENT, handler);
}

function isWatchVisiblePlan(plan: DivePlan): boolean {
  return plan.status !== 'completed' && !plan.convertedLogLocalId;
}

function makeUnavailablePlannedDivesStatus(payloadCount: number): PlannedWatchDivesUpdateStatus {
  return {
    nativeBridgeAvailable: false,
    isSupported: false,
    isPaired: false,
    isWatchAppInstalled: false,
    isReachable: false,
    activationState: 'unsupported',
    payloadCount,
    queuedCount: 0,
  };
}

function toWatchPlannedDivePayload(plan: DivePlan): WatchPlannedDivePayload {
  return {
    localId: plan.localId,
    title: plan.title,
    siteName: plan.site.name,
    diveMode: plan.diveMode,
    entryStyle: plan.entryStyle,
    plannedAt: plan.plannedAt,
    plannedMaxDepthMeters: plan.plannedValues.plannedMaxDepthMeters,
    plannedDurationMinutes: plan.plannedValues.plannedDurationMinutes,
    gasLabel: plan.plannedValues.gasLabel,
    buddyIds: plan.buddyIds,
    gearIds: plan.gearIds,
    tags: plan.tags,
    notes: buildPlanNotes(plan),
  };
}
