import type { WatchConnectivityPayload } from '../native/watch-connectivity';

export class WatchConnectivityImportCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly inFlightByPayloadId = new Map<string, Promise<unknown>>();

  run<T>(payload: WatchConnectivityPayload, operation: () => Promise<T>): Promise<T> {
    const payloadId = payload.payloadId;
    const existing = payloadId ? this.inFlightByPayloadId.get(payloadId) : undefined;

    if (existing) {
      return existing as Promise<T>;
    }

    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    if (payloadId) {
      this.inFlightByPayloadId.set(payloadId, result);
      const clearInFlight = () => {
        if (this.inFlightByPayloadId.get(payloadId) === result) {
          this.inFlightByPayloadId.delete(payloadId);
        }
      };
      void result.then(clearInFlight, clearInFlight);
    }

    return result;
  }
}

export const defaultWatchConnectivityImportCoordinator = new WatchConnectivityImportCoordinator();
