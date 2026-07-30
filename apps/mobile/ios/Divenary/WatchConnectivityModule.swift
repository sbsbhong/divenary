import Foundation
import React

@objc(WatchConnectivityModule)
final class WatchConnectivityModule: RCTEventEmitter {
  private var hasListeners = false
  private var payloadObserver: NSObjectProtocol?

  override init() {
    super.init()
    WatchConnectivityInbox.shared.activate()
  }

  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func supportedEvents() -> [String]! {
    [WatchConnectivityModule.eventName]
  }

  override func startObserving() {
    hasListeners = true
    payloadObserver = NotificationCenter.default.addObserver(
      forName: .diveWatchSyncPayloadReceived,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self,
            self.hasListeners,
            let payload = notification.userInfo else {
        return
      }

      self.sendEvent(withName: WatchConnectivityModule.eventName, body: payload)
    }
  }

  override func stopObserving() {
    hasListeners = false

    if let payloadObserver {
      NotificationCenter.default.removeObserver(payloadObserver)
      self.payloadObserver = nil
    }
  }

  @objc(drainPendingPayloads:rejecter:)
  func drainPendingPayloads(
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.drainPendingPayloads { payloads in
      resolve(payloads)
    }
  }

  @objc(preparePendingPayload:resolver:rejecter:)
  func preparePendingPayload(
    payloadId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.preparePendingPayload(
      payloadId: payloadId
    ) { result in
      switch result {
      case .success(let payload):
        resolve(payload)
      case .failure(let error):
        Self.rejectPreparation(error, reject: reject)
      }
    }
  }

  @objc(adoptPreparedProfile:destinationKey:resolver:rejecter:)
  func adoptPreparedProfile(
    payloadId: String,
    destinationKey: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.adoptPreparedProfile(
      payloadId: payloadId,
      destinationKey: destinationKey
    ) { result in
      switch result {
      case .success(let key):
        resolve(key)
      case .failure(let error):
        Self.rejectPreparation(error, reject: reject)
      }
    }
  }

  @objc(acknowledgePayloads:resolver:rejecter:)
  func acknowledgePayloads(
    payloadIds: [String],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.acknowledge(payloadIds: payloadIds) {
      resolve(nil)
    }
  }

  @objc(acknowledgeImportedPayloads:resolver:rejecter:)
  func acknowledgeImportedPayloads(
    payloadIds: [String],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.acknowledgeImported(payloadIds: payloadIds) {
      resolve(nil)
    }
  }

  @objc(queueSessionDeletion:resolver:rejecter:)
  func queueSessionDeletion(
    command: [String: Any],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.queueSessionDeletion(command: command) { result in
      switch result {
      case .success:
        resolve(nil)
      case .failure(let error):
        reject(
          "watch_session_deletion_invalid",
          "The Watch session deletion command is invalid.",
          error
        )
      }
    }
  }

  @objc(listSessionDeletionAcknowledgements:rejecter:)
  func listSessionDeletionAcknowledgements(
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.listSessionDeletionAcknowledgements {
      acknowledgements in
      resolve(acknowledgements)
    }
  }

  @objc(updatePlannedDives:resolver:rejecter:)
  func updatePlannedDives(
    plannedDivesJson: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.updatePlannedDives(
      json: plannedDivesJson
    ) { status in
      resolve(status)
    }
  }

  @objc(getLinkedWatchInfo:rejecter:)
  func getLinkedWatchInfo(
    resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.linkedWatchInfo { info in
      resolve(info)
    }
  }

  private static let eventName = "DiveWatchSyncPayloadReceived"

  private static func rejectPreparation(
    _ error: Error,
    reject: RCTPromiseRejectBlock
  ) {
    switch error {
    case WatchPayloadPreparationError.invalidPayload:
      reject(
        "watch_payload_invalid",
        "The pending Watch payload is invalid.",
        error
      )
    case WatchPayloadPreparationError.unavailable:
      reject(
        "watch_payload_unavailable",
        "The pending Watch payload is no longer available.",
        error
      )
    default:
      reject(
        "watch_payload_io_failed",
        "The pending Watch payload could not be read or written.",
        error
      )
    }
  }
}
