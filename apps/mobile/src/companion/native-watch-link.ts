import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  createUnavailableWatchLink,
  parseWatchSessionDeletionAcknowledgements,
  parseWatchSessionDeletionCommand,
  toWatchPlannedDivePayloads,
  unavailablePlannedDivesStatus,
  WatchPayloadPreparationError,
  type LinkedWatchInfo,
  type PlannedWatchDivesUpdateStatus,
  type PreparedWatchLinkPayload,
  type WatchLink,
  type WatchLinkPayload,
  type WatchSessionDeletionCommand,
} from './watch-link';

export const WATCH_LINK_PAYLOAD_EVENT = 'DiveWatchSyncPayloadReceived';

/**
 * The native module contract behind {@link WatchLink}. iOS implements it as
 * `WatchConnectivityModule` over WatchConnectivity. An Android build implements the same
 * methods and payload event as `WearableCompanionModule` over the Wearable Data Layer.
 * Arguments and results are plain JSON so either side can be swapped without touching app code.
 */
export type NativeWatchLinkModule = {
  drainPendingPayloads?: () => Promise<WatchLinkPayload[]>;
  preparePendingPayload?: (payloadId: string) => Promise<PreparedWatchLinkPayload>;
  adoptPreparedProfile?: (payloadId: string, destinationKey: string) => Promise<string>;
  acknowledgePayloads?: (payloadIds: string[]) => Promise<void>;
  acknowledgeImportedPayloads?: (payloadIds: string[]) => Promise<void>;
  queueSessionDeletion?: (command: WatchSessionDeletionCommand) => Promise<void>;
  listSessionDeletionAcknowledgements?: () => Promise<unknown>;
  updatePlannedDives?: (plannedDivesJson: string) => Promise<PlannedWatchDivesUpdateStatus | undefined>;
  getLinkedWatchInfo?: () => Promise<LinkedWatchInfo>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

export function resolveNativeWatchLinkModule(): NativeWatchLinkModule | undefined {
  const moduleName = Platform.select({
    ios: 'WatchConnectivityModule',
    android: 'WearableCompanionModule',
  });
  return moduleName ? (NativeModules[moduleName] as NativeWatchLinkModule | undefined) : undefined;
}

export function createNativeWatchLink(
  nativeModule: NativeWatchLinkModule | undefined,
  createEmitter: (module: NativeWatchLinkModule) => Pick<NativeEventEmitter, 'addListener'> = module =>
    new NativeEventEmitter(module),
): WatchLink {
  if (!nativeModule?.drainPendingPayloads) {
    return createUnavailableWatchLink();
  }
  const module = nativeModule;
  const unavailable = createUnavailableWatchLink();

  return {
    isAvailable: () => true,
    drainPendingPayloads: () => module.drainPendingPayloads?.() ?? Promise.resolve([]),
    preparePendingPayload: async payload => {
      if (payload.payloadJson !== undefined) {
        return { ...payload, payloadJson: payload.payloadJson };
      }
      if (!payload.payloadId || !module.preparePendingPayload) {
        throw new WatchPayloadPreparationError('unavailable');
      }
      try {
        return await module.preparePendingPayload(payload.payloadId);
      } catch (error) {
        throw classifyPreparationError(error);
      }
    },
    adoptPreparedProfile: async (payloadId, destinationKey) => {
      if (!module.adoptPreparedProfile) {
        throw new WatchPayloadPreparationError('unavailable');
      }
      try {
        return await module.adoptPreparedProfile(payloadId, destinationKey);
      } catch (error) {
        throw classifyPreparationError(error);
      }
    },
    discardPayloads: async payloadIds => {
      if (module.acknowledgePayloads && payloadIds.length > 0) {
        await module.acknowledgePayloads([...payloadIds]);
      }
    },
    acknowledgeImportedPayloads: async payloadIds => {
      if (module.acknowledgeImportedPayloads && payloadIds.length > 0) {
        await module.acknowledgeImportedPayloads([...payloadIds]);
      }
    },
    queueSessionDeletion: async command => {
      const normalized = parseWatchSessionDeletionCommand(command);
      await module.queueSessionDeletion?.(normalized);
    },
    listSessionDeletionAcknowledgements: async () =>
      module.listSessionDeletionAcknowledgements
        ? parseWatchSessionDeletionAcknowledgements(await module.listSessionDeletionAcknowledgements())
        : [],
    updatePlannedDives: async plans => {
      const plannedDives = toWatchPlannedDivePayloads(plans);
      if (!module.updatePlannedDives) {
        return unavailablePlannedDivesStatus(plannedDives.length);
      }
      const status = await module.updatePlannedDives(JSON.stringify(plannedDives));
      return {
        ...unavailablePlannedDivesStatus(plannedDives.length),
        nativeBridgeAvailable: true,
        ...status,
        payloadCount: status?.payloadCount ?? plannedDives.length,
      };
    },
    getLinkedWatchInfo: () => module.getLinkedWatchInfo?.() ?? unavailable.getLinkedWatchInfo(),
    subscribeToPayloads: handler => createEmitter(module).addListener(WATCH_LINK_PAYLOAD_EVENT, handler),
  };
}

function classifyPreparationError(error: unknown): WatchPayloadPreparationError {
  if (error instanceof WatchPayloadPreparationError) {
    return error;
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  return new WatchPayloadPreparationError(
    code === 'watch_payload_invalid' ? 'invalid' : code === 'watch_payload_unavailable' ? 'unavailable' : 'io',
    { cause: error },
  );
}
