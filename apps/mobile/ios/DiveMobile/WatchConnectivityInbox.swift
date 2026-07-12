import Foundation
import WatchConnectivity

extension Notification.Name {
  static let diveWatchSyncPayloadReceived = Notification.Name("DiveWatchSyncPayloadReceived")
}

final class WatchConnectivityInbox: NSObject, WCSessionDelegate {
  static let shared = WatchConnectivityInbox()

  private static let storageKey = "watchConnectivityPendingPayloads"
  private static let plannedDivesContextStorageKey = "watchConnectivityLatestPlannedDivesJson"

  private let connectivitySession: WCSession?
  private let userDefaults: UserDefaults
  private var isActivated = false
  private var pendingPayloads: [PendingWatchConnectivityPayload] = []
  private var pendingPlannedDivesJson: String?
  private var lastPlannedDivesContextError: NSError?

  private override init() {
    connectivitySession = WCSession.isSupported() ? WCSession.default : nil
    userDefaults = .standard
    super.init()
    pendingPayloads = Self.loadPendingPayloads(from: userDefaults)
    pendingPlannedDivesJson = userDefaults.string(forKey: Self.plannedDivesContextStorageKey)
    connectivitySession?.delegate = self
  }

  func activate() {
    guard !isActivated else {
      return
    }

    isActivated = true
    connectivitySession?.activate()
  }

  func drainPendingPayloads() -> [[String: Any]] {
    if Thread.isMainThread {
      return drainPendingPayloadsOnMainQueue()
    }

    return DispatchQueue.main.sync {
      drainPendingPayloadsOnMainQueue()
    }
  }

  func acknowledge(payloadIds: [String]) {
    if Thread.isMainThread {
      acknowledgeOnMainQueue(payloadIds: payloadIds)
      return
    }

    DispatchQueue.main.sync {
      acknowledgeOnMainQueue(payloadIds: payloadIds)
    }
  }

  func acknowledgeImported(payloadIds: [String]) {
    if Thread.isMainThread {
      acknowledgeImportedOnMainQueue(payloadIds: payloadIds)
      return
    }

    DispatchQueue.main.sync {
      acknowledgeImportedOnMainQueue(payloadIds: payloadIds)
    }
  }

  func updatePlannedDives(json plannedDivesJson: String) -> [String: Any] {
    if Thread.isMainThread {
      return updatePlannedDivesOnMainQueue(json: plannedDivesJson)
    }

    return DispatchQueue.main.sync {
      updatePlannedDivesOnMainQueue(json: plannedDivesJson)
    }
  }

  func linkedWatchInfo() -> [String: Any] {
    if Thread.isMainThread {
      return linkedWatchInfoOnMainQueue()
    }

    return DispatchQueue.main.sync {
      linkedWatchInfoOnMainQueue()
    }
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard error == nil, activationState == .activated else {
      return
    }

    DispatchQueue.main.async { [weak self] in
      self?.flushPendingPlannedDivesContextOnMainQueue()
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    guard session.isReachable else {
      return
    }

    DispatchQueue.main.async { [weak self] in
      self?.flushPendingPlannedDivesContextOnMainQueue()
    }
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    DispatchQueue.main.async { [weak self] in
      self?.flushPendingPlannedDivesContextOnMainQueue()
    }
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    enqueuePendingPayload(from: userInfo)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    enqueuePendingPayload(from: message)
  }

  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    guard file.metadata?[WatchConnectivityEnvelopeKey.kind] as? String == WatchConnectivityEnvelopeValue.kind,
          let payloadData = try? Data(contentsOf: file.fileURL),
          let payloadJson = String(data: payloadData, encoding: .utf8) else {
      return
    }

    enqueuePendingPayload(
      payloadJson: payloadJson,
      localSessionId: file.metadata?[WatchConnectivityEnvelopeKey.localSessionId] as? String
    )
  }

  private func enqueuePendingPayload(from userInfo: [String: Any]) {
    guard let payload = makePendingPayload(from: userInfo) else {
      return
    }

    DispatchQueue.main.async {
      self.pendingPayloads.append(payload)
      self.persistPendingPayloads()
      NotificationCenter.default.post(name: .diveWatchSyncPayloadReceived, object: self, userInfo: payload.dictionary)
    }
  }

  private func enqueuePendingPayload(payloadJson: String, localSessionId: String?) {
    let payload = PendingWatchConnectivityPayload(
      payloadId: UUID().uuidString,
      payloadJson: payloadJson,
      localSessionId: localSessionId,
      receivedAt: Date().timeIntervalSince1970
    )

    DispatchQueue.main.async {
      self.pendingPayloads.append(payload)
      self.persistPendingPayloads()
      NotificationCenter.default.post(name: .diveWatchSyncPayloadReceived, object: self, userInfo: payload.dictionary)
    }
  }

  private func makePendingPayload(from userInfo: [String: Any]) -> PendingWatchConnectivityPayload? {
    guard userInfo[WatchConnectivityEnvelopeKey.kind] as? String == WatchConnectivityEnvelopeValue.kind,
          let payloadBase64 = userInfo[WatchConnectivityEnvelopeKey.payloadBase64] as? String,
          let payloadData = Data(base64Encoded: payloadBase64),
          let payloadJson = String(data: payloadData, encoding: .utf8) else {
      return nil
    }

    return PendingWatchConnectivityPayload(
      payloadId: UUID().uuidString,
      payloadJson: payloadJson,
      localSessionId: userInfo[WatchConnectivityEnvelopeKey.localSessionId] as? String,
      receivedAt: Date().timeIntervalSince1970
    )
  }

  private func drainPendingPayloadsOnMainQueue() -> [[String: Any]] {
    pendingPayloads.map(\.dictionary)
  }

  private func acknowledgeOnMainQueue(payloadIds: [String]) {
    let payloadIdSet = Set(payloadIds)
    guard !payloadIdSet.isEmpty else {
      return
    }

    pendingPayloads.removeAll { payloadIdSet.contains($0.payloadId) }
    persistPendingPayloads()
  }

  private func acknowledgeImportedOnMainQueue(payloadIds: [String]) {
    let payloadIdSet = Set(payloadIds)
    guard !payloadIdSet.isEmpty else {
      return
    }

    let localSessionIds = pendingPayloads
      .filter { payloadIdSet.contains($0.payloadId) }
      .compactMap(\.localSessionId)

    enqueueImportAcknowledgements(localSessionIds: localSessionIds)
    acknowledgeOnMainQueue(payloadIds: payloadIds)
  }

  private func enqueueImportAcknowledgements(localSessionIds: [String]) {
    guard let connectivitySession else {
      return
    }

    let acknowledgedAt = Date().timeIntervalSince1970
    for localSessionId in Set(localSessionIds) {
      let acknowledgement: [String: Any] = [
        WatchConnectivityEnvelopeKey.kind: WatchConnectivityEnvelopeValue.acknowledgementKind,
        WatchConnectivityEnvelopeKey.localSessionId: localSessionId,
        WatchConnectivityEnvelopeKey.acknowledgedAt: acknowledgedAt
      ]

      if connectivitySession.isReachable {
        connectivitySession.sendMessage(acknowledgement, replyHandler: nil) { _ in }
      }
      connectivitySession.transferUserInfo(acknowledgement)
    }
  }

  private func updatePlannedDivesOnMainQueue(json plannedDivesJson: String) -> [String: Any] {
    pendingPlannedDivesJson = plannedDivesJson
    userDefaults.set(plannedDivesJson, forKey: Self.plannedDivesContextStorageKey)
    flushPendingPlannedDivesContextOnMainQueue()
    return plannedDivesStatusOnMainQueue(payloadCount: Self.countPlannedDives(in: plannedDivesJson))
  }

  private func flushPendingPlannedDivesContextOnMainQueue() {
    guard let connectivitySession,
          connectivitySession.activationState == .activated,
          let plannedDivesJson = pendingPlannedDivesJson else {
      return
    }

    guard connectivitySession.isPaired,
          connectivitySession.isWatchAppInstalled else {
      return
    }

    let context: [String: Any] = [
      WatchConnectivityEnvelopeKey.kind: WatchConnectivityEnvelopeValue.plannedDivesKind,
      WatchConnectivityEnvelopeKey.plannedDivesJson: plannedDivesJson,
      WatchConnectivityEnvelopeKey.updatedAt: Date().timeIntervalSince1970
    ]

    guard PropertyListSerialization.propertyList(context, isValidFor: .binary) else {
      lastPlannedDivesContextError = Self.makePlannedDivesContextError(
        code: PlannedDivesContextUpdateErrorCode.unsupportedPropertyList.rawValue,
        description: "Planned dives context contains values that WatchConnectivity cannot serialize."
      )
      return
    }

    if connectivitySession.isReachable {
      connectivitySession.sendMessage(context, replyHandler: nil) { _ in }
    }

    if connectivitySession.applicationContext[WatchConnectivityEnvelopeKey.plannedDivesJson] as? String == plannedDivesJson {
      lastPlannedDivesContextError = nil
      return
    }

    if let error = Self.updateApplicationContextWithoutThrow(context, on: connectivitySession) {
      lastPlannedDivesContextError = error
      // The latest payload stays persisted and will be retried on the next watch state change.
      return
    }

    lastPlannedDivesContextError = nil
  }

  private func linkedWatchInfoOnMainQueue() -> [String: Any] {
    guard WCSession.isSupported(),
          let connectivitySession else {
      return [
        "nativeBridgeAvailable": true,
        "isSupported": false,
        "isPaired": false,
        "isWatchAppInstalled": false,
        "isReachable": false
      ]
    }

    var info: [String: Any] = [
      "nativeBridgeAvailable": true,
      "isSupported": true,
      "isPaired": connectivitySession.isPaired,
      "isWatchAppInstalled": connectivitySession.isWatchAppInstalled,
      "isReachable": connectivitySession.isReachable
    ]

    if connectivitySession.isPaired {
      info["name"] = "Apple Watch"
    }

    return info
  }

  private func plannedDivesStatusOnMainQueue(payloadCount: Int) -> [String: Any] {
    var status = linkedWatchInfoOnMainQueue()
    status["activationState"] = activationStateName(for: connectivitySession?.activationState)
    status["payloadCount"] = payloadCount
    status["queuedCount"] = pendingPlannedDivesJson == nil ? 0 : 1
    status["updatedAt"] = Date().timeIntervalSince1970

    if let lastPlannedDivesContextError {
      status["lastContextErrorDomain"] = lastPlannedDivesContextError.domain
      status["lastContextErrorCode"] = lastPlannedDivesContextError.code
      status["lastContextErrorDescription"] = lastPlannedDivesContextError.localizedDescription
    }

    return status
  }

  private static func updateApplicationContextWithoutThrow(
    _ context: [String: Any],
    on connectivitySession: WCSession
  ) -> NSError? {
    let selector = NSSelectorFromString("updateApplicationContext:error:")

    guard connectivitySession.responds(to: selector),
          let implementation = connectivitySession.method(for: selector) else {
      return makePlannedDivesContextError(
        code: PlannedDivesContextUpdateErrorCode.missingSelector.rawValue,
        description: "WCSession does not expose updateApplicationContext:error:."
      )
    }

    let updateApplicationContext = unsafeBitCast(implementation, to: UpdateApplicationContextIMP.self)
    var contextError: NSError?
    let didUpdate = updateApplicationContext(connectivitySession, selector, context as NSDictionary, &contextError)

    if didUpdate {
      return nil
    }

    return contextError ?? makePlannedDivesContextError(
      code: PlannedDivesContextUpdateErrorCode.unknownFailure.rawValue,
      description: "WCSession rejected the planned dives application context without an NSError."
    )
  }

  private static func makePlannedDivesContextError(code: Int, description: String) -> NSError {
    NSError(
      domain: PlannedDivesContextUpdateErrorDomain,
      code: code,
      userInfo: [NSLocalizedDescriptionKey: description]
    )
  }

  private func activationStateName(for activationState: WCSessionActivationState?) -> String {
    switch activationState {
    case .notActivated:
      return "notActivated"
    case .inactive:
      return "inactive"
    case .activated:
      return "activated"
    case nil:
      return "unsupported"
    @unknown default:
      return "unknown"
    }
  }

  private static func countPlannedDives(in plannedDivesJson: String) -> Int {
    guard let data = plannedDivesJson.data(using: .utf8),
          let items = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
      return 0
    }

    return items.count
  }

  private func persistPendingPayloads() {
    do {
      let data = try JSONEncoder().encode(pendingPayloads)
      userDefaults.set(data, forKey: Self.storageKey)
    } catch {
      assertionFailure("Failed to persist watch connectivity payloads: \(error)")
    }
  }

  private static func loadPendingPayloads(from userDefaults: UserDefaults) -> [PendingWatchConnectivityPayload] {
    guard let data = userDefaults.data(forKey: storageKey) else {
      return []
    }

    do {
      return try JSONDecoder().decode([PendingWatchConnectivityPayload].self, from: data)
    } catch {
      userDefaults.removeObject(forKey: storageKey)
      return []
    }
  }
}

private struct PendingWatchConnectivityPayload: Codable {
  let payloadId: String
  let payloadJson: String
  let localSessionId: String?
  let receivedAt: TimeInterval

  var dictionary: [String: Any] {
    var payload: [String: Any] = [
      "payloadId": payloadId,
      "payloadJson": payloadJson,
      "receivedAt": receivedAt
    ]

    if let localSessionId {
      payload["localSessionId"] = localSessionId
    }

    return payload
  }
}

private typealias UpdateApplicationContextIMP = @convention(c) (
  AnyObject,
  Selector,
  NSDictionary,
  AutoreleasingUnsafeMutablePointer<NSError?>
) -> Bool

private let PlannedDivesContextUpdateErrorDomain = "DiveMobileWatchConnectivity.PlannedDivesContext"

private enum PlannedDivesContextUpdateErrorCode: Int {
  case unsupportedPropertyList = 1
  case missingSelector = 2
  case unknownFailure = 3
}

private enum WatchConnectivityEnvelopeKey {
  static let kind = "kind"
  static let payloadBase64 = "payloadBase64"
  static let localSessionId = "localSessionId"
  static let acknowledgedAt = "acknowledgedAt"
  static let plannedDivesJson = "plannedDivesJson"
  static let updatedAt = "updatedAt"
}

private enum WatchConnectivityEnvelopeValue {
  static let kind = "watchSyncMessage"
  static let acknowledgementKind = "watchSyncAcknowledgement"
  static let plannedDivesKind = "watchPlannedDives"
}
