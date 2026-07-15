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
  func drainPendingPayloads(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(WatchConnectivityInbox.shared.drainPendingPayloads())
  }

  @objc(acknowledgePayloads:resolver:rejecter:)
  func acknowledgePayloads(
    payloadIds: [String],
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.acknowledge(payloadIds: payloadIds)
    resolve(nil)
  }

  @objc(acknowledgeImportedPayloads:resolver:rejecter:)
  func acknowledgeImportedPayloads(
    payloadIds: [String],
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    WatchConnectivityInbox.shared.acknowledgeImported(payloadIds: payloadIds)
    resolve(nil)
  }

  @objc(updatePlannedDives:resolver:rejecter:)
  func updatePlannedDives(
    plannedDivesJson: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(WatchConnectivityInbox.shared.updatePlannedDives(json: plannedDivesJson))
  }

  @objc(getLinkedWatchInfo:rejecter:)
  func getLinkedWatchInfo(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(WatchConnectivityInbox.shared.linkedWatchInfo())
  }

  private static let eventName = "DiveWatchSyncPayloadReceived"
}
