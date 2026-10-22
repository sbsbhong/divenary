import type {
  WatchPlannedDive,
  WatchSessionDeletionAcknowledgement as WatchSessionDeletionAcknowledgementMessage,
  WatchSessionDeletionCommand as WatchSessionDeletionCommandMessage,
} from '../../../../packages/contracts/generated/typescript/watch-link';
import type { DivePlan } from '../types/dive-plan';
import { buildPlanNotes } from '../utils/dive-plan-to-log-entry';

/**
 * Platform-neutral link between the phone app and its companion watch app.
 *
 * App code depends only on this interface. Each platform adapts its own transport to it:
 * Apple Watch through WatchConnectivity today, and a Wear OS watch through the Wearable Data
 * Layer later. Everything that crosses the link is plain JSON defined by the schemas in
 * `packages/contracts` (`watch-sync-message`, `watch-link-messages`, `watch-planned-dive`),
 * so no message shape depends on a platform.
 */
export type WatchLink = {
  /** Whether this device has a companion transport at all. */
  isAvailable(): boolean;
  /** Session payloads received while the app was not listening, oldest first. */
  drainPendingPayloads(): Promise<WatchLinkPayload[]>;
  /** Reads a received session file into JSON and stages its full profile for adoption. */
  preparePendingPayload(payload: WatchLinkPayload): Promise<PreparedWatchLinkPayload>;
  /** Moves a staged profile into app storage and returns where it was stored. */
  adoptPreparedProfile(payloadId: string, destinationKey: string): Promise<string>;
  /** Drops payloads from the phone inbox without telling the watch they were imported. */
  discardPayloads(payloadIds: readonly string[]): Promise<void>;
  /** Removes payloads from the phone inbox and tells the watch they are saved locally. */
  acknowledgeImportedPayloads(payloadIds: readonly string[]): Promise<void>;
  queueSessionDeletion(command: WatchSessionDeletionCommand): Promise<void>;
  listSessionDeletionAcknowledgements(): Promise<WatchSessionDeletionAcknowledgement[]>;
  /** Replaces the watch's planned dive list with the plans it should still offer. */
  updatePlannedDives(plans: readonly DivePlan[]): Promise<PlannedWatchDivesUpdateStatus>;
  getLinkedWatchInfo(): Promise<LinkedWatchInfo>;
  subscribeToPayloads(handler: (payload: WatchLinkPayload) => void): WatchLinkSubscription;
};

export type WatchLinkPayload = {
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

export type PreparedWatchLinkPayload = WatchLinkPayload & {
  payloadJson: string;
  preparedProfile?: PreparedWatchProfile;
};

export type WatchLinkSubscription = {
  remove(): void;
};

export type WatchPayloadPreparationErrorCode = 'unavailable' | 'invalid' | 'io';

export class WatchPayloadPreparationError extends Error {
  constructor(
    readonly code: WatchPayloadPreparationErrorCode,
    options?: { cause?: unknown },
  ) {
    super(`Watch payload preparation failed: ${code}`);
    this.name = 'WatchPayloadPreparationError';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isInvalidPreparedWatchPayloadError(error: unknown): boolean {
  return error instanceof WatchPayloadPreparationError && error.code === 'invalid';
}

/** A deletion command as the app hands it to the platform layer, which adds `kind` on the wire. */
export type WatchSessionDeletionCommand = Omit<
  WatchSessionDeletionCommandMessage,
  'kind' | 'formatVersion'
> & {formatVersion: 1};

/** A deletion receipt as the platform layer returns it, without the wire `kind`. */
export type WatchSessionDeletionAcknowledgement = Omit<
  WatchSessionDeletionAcknowledgementMessage,
  'kind' | 'formatVersion'
> & {formatVersion: 1};

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

/** The planned dive shape the watch receives; it carries no account or backend identifiers. */
export type WatchPlannedDivePayload = WatchPlannedDive;

export const unavailableLinkedWatchInfo: LinkedWatchInfo = {
  nativeBridgeAvailable: false,
  isSupported: false,
  isPaired: false,
  isWatchAppInstalled: false,
  isReachable: false,
};

export function unavailablePlannedDivesStatus(payloadCount: number): PlannedWatchDivesUpdateStatus {
  return {
    ...unavailableLinkedWatchInfo,
    activationState: 'unsupported',
    payloadCount,
    queuedCount: 0,
  };
}

/** A link for devices without a companion watch transport: everything is a quiet no-op. */
export function createUnavailableWatchLink(): WatchLink {
  return {
    isAvailable: () => false,
    drainPendingPayloads: async () => [],
    preparePendingPayload: async payload => {
      if (payload.payloadJson !== undefined) {
        return { ...payload, payloadJson: payload.payloadJson };
      }
      throw new WatchPayloadPreparationError('unavailable');
    },
    adoptPreparedProfile: async () => {
      throw new WatchPayloadPreparationError('unavailable');
    },
    discardPayloads: async () => undefined,
    acknowledgeImportedPayloads: async () => undefined,
    queueSessionDeletion: async command => {
      parseWatchSessionDeletionCommand(command);
    },
    listSessionDeletionAcknowledgements: async () => [],
    updatePlannedDives: async plans => unavailablePlannedDivesStatus(toWatchPlannedDivePayloads(plans).length),
    getLinkedWatchInfo: async () => unavailableLinkedWatchInfo,
    subscribeToPayloads: () => ({ remove() {} }),
  };
}

export function toWatchPlannedDivePayloads(plans: readonly DivePlan[]): WatchPlannedDivePayload[] {
  return plans.filter(isWatchVisiblePlan).map(plan => ({
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
  }));
}

/** Only a `planned` dive that has not become a log yet reaches the watch; drafts stay on the iPhone. */
export function isWatchVisiblePlan(plan: DivePlan): boolean {
  return plan.status === 'planned' && !plan.convertedLogLocalId;
}

export function parseWatchSessionDeletionCommand(value: unknown): WatchSessionDeletionCommand {
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

export function parseWatchSessionDeletionAcknowledgements(raw: unknown): WatchSessionDeletionAcknowledgement[] {
  if (!Array.isArray(raw)) {
    throw new WatchSessionDeletionBridgeError();
  }
  return raw.map(parseWatchSessionDeletionAcknowledgement).sort(
    (left, right) =>
      left.acknowledgedAt - right.acknowledgedAt ||
      left.localSessionId.localeCompare(right.localSessionId),
  );
}

function parseWatchSessionDeletionAcknowledgement(value: unknown): WatchSessionDeletionAcknowledgement {
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

function hasAllowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
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
