import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { DivePlan } from '../types/dive-plan';
import { buildPlanNotes } from '../utils/dive-plan-to-log-entry';

export const WATCH_CONNECTIVITY_PAYLOAD_EVENT = 'DiveWatchSyncPayloadReceived';

export type WatchConnectivityPayload = {
  payloadId?: string;
  payloadJson?: string;
  localSessionId?: string;
  receivedAt?: number;
  contentRevision?: string;
  sha256?: string;
};

export type PreparedWatchProfile = {
  payloadId: string;
  sampleCount: number;
  byteCount: number;
  sha256: string;
};

export type PreparedWatchConnectivityPayload = WatchConnectivityPayload & {
  payloadJson: string;
  preparedProfile?: PreparedWatchProfile;
};

export type WatchPayloadPreparationErrorCode =
  | 'unavailable'
  | 'invalid'
  | 'io';

export class WatchPayloadPreparationError extends Error {
  constructor(
    readonly code: WatchPayloadPreparationErrorCode,
    options?: {cause?: unknown},
  ) {
    super(`Watch payload preparation failed: ${code}`);
    this.name = 'WatchPayloadPreparationError';
    if (options?.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

export type WatchConnectivitySubscription = {
  remove(): void;
};

export type WatchSessionDeletionCommand = {
  formatVersion: 1;
  commandId: string;
  localSessionId: string;
  requestedAt: number;
  contentRevision?: string;
  artifactSha256?: string;
};

export type WatchSessionDeletionAcknowledgement = {
  formatVersion: 1;
  commandId: string;
  localSessionId: string;
  acknowledgedAt: number;
  result: 'deleted' | 'alreadyAbsent';
  removedContentRevision?: string;
  removedArtifactSha256?: string;
};

export class WatchSessionDeletionBridgeError extends Error {
  constructor(message = 'Malformed Watch session deletion bridge data') {
    super(message);
    this.name = 'WatchSessionDeletionBridgeError';
  }
}

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
  preparePendingPayload?: (
    payloadId: string,
  ) => Promise<PreparedWatchConnectivityPayload>;
  adoptPreparedProfile?: (
    payloadId: string,
    destinationKey: string,
  ) => Promise<string>;
  acknowledgePayloads?: (payloadIds: string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: string[]) => Promise<void>;
  queueSessionDeletion?: (
    command: WatchSessionDeletionCommand,
  ) => Promise<void>;
  listSessionDeletionAcknowledgements?: () => Promise<unknown>;
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

export async function preparePendingWatchConnectivityPayload(
  payload: WatchConnectivityPayload,
  preparePendingPayload = nativeModule?.preparePendingPayload?.bind(
    nativeModule,
  ),
): Promise<PreparedWatchConnectivityPayload> {
  if (payload.payloadJson !== undefined) {
    return {...payload, payloadJson: payload.payloadJson};
  }
  if (!payload.payloadId || !preparePendingPayload) {
    throw new WatchPayloadPreparationError('unavailable');
  }

  try {
    return await preparePendingPayload(payload.payloadId);
  } catch (error) {
    throw classifyPreparationError(error);
  }
}

export async function adoptPreparedWatchConnectivityProfile(
  payloadId: string,
  destinationKey: string,
): Promise<string> {
  if (!nativeModule?.adoptPreparedProfile) {
    throw new WatchPayloadPreparationError('unavailable');
  }

  try {
    return await nativeModule.adoptPreparedProfile(payloadId, destinationKey);
  } catch (error) {
    throw classifyPreparationError(error);
  }
}

export function isInvalidPreparedWatchPayloadError(
  error: unknown,
): boolean {
  return (
    error instanceof WatchPayloadPreparationError && error.code === 'invalid'
  );
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

export async function queueWatchSessionDeletion(
  command: WatchSessionDeletionCommand,
  queue = nativeModule?.queueSessionDeletion?.bind(nativeModule),
): Promise<void> {
  const normalized = parseDeletionCommand(command);
  if (!queue) {
    return;
  }
  await queue(normalized);
}

export async function listWatchSessionDeletionAcknowledgements(
  list = nativeModule?.listSessionDeletionAcknowledgements?.bind(nativeModule),
): Promise<WatchSessionDeletionAcknowledgement[]> {
  if (!list) {
    return [];
  }
  const raw = await list();
  if (!Array.isArray(raw)) {
    throw new WatchSessionDeletionBridgeError();
  }
  return raw.map(parseDeletionAcknowledgement).sort(
    (left, right) =>
      left.acknowledgedAt - right.acknowledgedAt ||
      left.localSessionId.localeCompare(right.localSessionId),
  );
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

function classifyPreparationError(
  error: unknown,
): WatchPayloadPreparationError {
  if (error instanceof WatchPayloadPreparationError) {
    return error;
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined;
  return new WatchPayloadPreparationError(
    code === 'watch_payload_invalid'
      ? 'invalid'
      : code === 'watch_payload_unavailable'
        ? 'unavailable'
        : 'io',
    {cause: error},
  );
}

function parseDeletionCommand(value: unknown): WatchSessionDeletionCommand {
  if (
    !isRecord(value) ||
    !hasAllowedKeys(value, [
      'formatVersion',
      'commandId',
      'localSessionId',
      'requestedAt',
      'contentRevision',
      'artifactSha256',
    ]) ||
    value.formatVersion !== 1 ||
    !isSha(value.commandId) ||
    !isNonEmptyString(value.localSessionId) ||
    !isTimestamp(value.requestedAt)
  ) {
    throw new WatchSessionDeletionBridgeError();
  }
  const hasRevision = value.contentRevision !== undefined;
  const hasDigest = value.artifactSha256 !== undefined;
  if (
    hasRevision !== hasDigest ||
    (hasRevision && !isNonEmptyString(value.contentRevision)) ||
    (hasDigest && !isSha(value.artifactSha256))
  ) {
    throw new WatchSessionDeletionBridgeError();
  }
  return {
    formatVersion: 1,
    commandId: value.commandId,
    localSessionId: value.localSessionId,
    requestedAt: value.requestedAt,
    ...(hasRevision && hasDigest
      ? {
          contentRevision: value.contentRevision as string,
          artifactSha256: value.artifactSha256 as string,
        }
      : {}),
  };
}

function parseDeletionAcknowledgement(
  value: unknown,
): WatchSessionDeletionAcknowledgement {
  if (
    !isRecord(value) ||
    !hasAllowedKeys(value, [
      'formatVersion',
      'commandId',
      'localSessionId',
      'acknowledgedAt',
      'result',
      'removedContentRevision',
      'removedArtifactSha256',
    ]) ||
    value.formatVersion !== 1 ||
    !isSha(value.commandId) ||
    !isNonEmptyString(value.localSessionId) ||
    !isTimestamp(value.acknowledgedAt) ||
    (value.result !== 'deleted' && value.result !== 'alreadyAbsent')
  ) {
    throw new WatchSessionDeletionBridgeError();
  }
  const hasRevision = value.removedContentRevision !== undefined;
  const hasDigest = value.removedArtifactSha256 !== undefined;
  if (
    hasRevision !== hasDigest ||
    (hasRevision && !isNonEmptyString(value.removedContentRevision)) ||
    (hasDigest && !isSha(value.removedArtifactSha256))
  ) {
    throw new WatchSessionDeletionBridgeError();
  }
  return {
    formatVersion: 1,
    commandId: value.commandId,
    localSessionId: value.localSessionId,
    acknowledgedAt: value.acknowledgedAt,
    result: value.result,
    ...(hasRevision && hasDigest
      ? {
          removedContentRevision: value.removedContentRevision as string,
          removedArtifactSha256: value.removedArtifactSha256 as string,
        }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
