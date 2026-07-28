import CryptoKit
import Foundation
import JavaScriptCore
import WatchConnectivity

extension Notification.Name {
  static let diveWatchSyncPayloadReceived = Notification.Name("DiveWatchSyncPayloadReceived")
}

final class WatchConnectivityInbox: NSObject, WCSessionDelegate {
  static let shared = WatchConnectivityInbox()

  private static let storageKey = "watchConnectivityPendingPayloads"
  private static let acknowledgementStorageKey = "watchConnectivityPendingAcknowledgements"
  private static let plannedDivesContextStorageKey = "watchConnectivityLatestPlannedDivesJson"

  private let connectivitySession: WCSession?
  private let userDefaults: UserDefaults
  private let stateQueue = DispatchQueue(label: "com.divenary.watch-connectivity-inbox", qos: .utility)
  private let preparationQueue = DispatchQueue(
    label: "com.divenary.watch-connectivity-preparation",
    qos: .utility
  )
  private let stateQueueKey = DispatchSpecificKey<Void>()
  private var isActivated = false
  private var pendingPayloads: [PendingWatchConnectivityPayload] = []
  private var pendingAcknowledgements: [PendingWatchConnectivityAcknowledgement] = []
  private var pendingPlannedDivesJson: String?
  private var lastPlannedDivesContextError: NSError?

  private override init() {
    connectivitySession = WCSession.isSupported() ? WCSession.default : nil
    userDefaults = .standard
    super.init()
    stateQueue.setSpecific(key: stateQueueKey, value: ())
    stateQueue.async { [weak self] in
      guard let self else { return }
      self.pendingPayloads = Self.loadPendingPayloads(from: self.userDefaults)
      self.pendingAcknowledgements = Self.loadPendingAcknowledgements(from: self.userDefaults)
      self.pendingPlannedDivesJson = self.userDefaults.string(
        forKey: Self.plannedDivesContextStorageKey
      )
      self.connectivitySession?.delegate = self
    }
  }

  func activate() {
    stateQueue.async { [weak self] in
      guard let self, !self.isActivated else {
        return
      }

      self.isActivated = true
      self.connectivitySession?.activate()
    }
  }

  func drainPendingPayloads(
    completion: @escaping ([[String: Any]]) -> Void
  ) {
    stateQueue.async { [weak self] in
      guard let self else {
        completion([])
        return
      }
      let payloads = self.measureSlowStage("watch-import") {
        self.pendingPayloads
          .prefix(8)
          .map(\.descriptorDictionary)
      }
      completion(payloads)
    }
  }

  func preparePendingPayload(
    payloadId: String,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    stateQueue.async { [weak self] in
      self?.preparePendingPayloadOnStateQueue(
        payloadId: payloadId,
        completion: completion
      )
    }
  }

  func adoptPreparedProfile(
    payloadId: String,
    destinationKey: String,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    stateQueue.async { [weak self] in
      guard let self,
            let payload = self.pendingPayloads.first(where: {
              $0.payloadId == payloadId
            }),
            let preparedProfileFilePath = payload.preparedProfileFilePath,
            let preparedProfileSha256 = payload.preparedProfileSha256,
            let preparedProfileByteCount = payload.preparedProfileByteCount else {
        completion(.failure(WatchPayloadPreparationError.unavailable))
        return
      }

      self.preparationQueue.async {
        do {
          let data = try Data(contentsOf: URL(fileURLWithPath: preparedProfileFilePath))
          guard data.count == preparedProfileByteCount,
                Self.sha256Hex(data) == preparedProfileSha256,
                try JSONSerialization.jsonObject(with: data) is [Any] else {
            throw WatchPayloadPreparationError.io(
              CocoaError(.fileReadCorruptFile)
            )
          }
          let destinationURL = try WatchProfileStorageModule.profileURL(
            for: destinationKey
          )
          try data.write(to: destinationURL, options: .atomic)
          completion(.success(destinationKey))
        } catch let error as WatchPayloadPreparationError {
          completion(.failure(error))
        } catch {
          completion(.failure(WatchPayloadPreparationError.io(error)))
        }
      }
    }
  }

  func acknowledge(
    payloadIds: [String],
    completion: @escaping () -> Void
  ) {
    stateQueue.async { [weak self] in
      self?.acknowledgeOnStateQueue(payloadIds: payloadIds)
      completion()
    }
  }

  func acknowledgeImported(
    payloadIds: [String],
    completion: @escaping () -> Void
  ) {
    stateQueue.async { [weak self] in
      self?.acknowledgeImportedOnStateQueue(payloadIds: payloadIds)
      completion()
    }
  }

  func updatePlannedDives(
    json plannedDivesJson: String,
    completion: @escaping ([String: Any]) -> Void
  ) {
    stateQueue.async { [weak self] in
      let status = self?.updatePlannedDivesOnStateQueue(
        json: plannedDivesJson
      ) ?? [:]
      completion(status)
    }
  }

  func linkedWatchInfo(
    completion: @escaping ([String: Any]) -> Void
  ) {
    stateQueue.async { [weak self] in
      completion(self?.linkedWatchInfoOnStateQueue() ?? [:])
    }
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard error == nil, activationState == .activated else {
      stateQueue.async { [weak self] in
        self?.isActivated = false
      }
      return
    }

    stateQueue.async { [weak self] in
      self?.flushPendingPlannedDivesContextOnStateQueue()
      self?.flushPendingAcknowledgementsOnStateQueue()
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    stateQueue.async {
      session.activate()
    }
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    stateQueue.async { [weak self] in
      guard session.isReachable else {
        return
      }
      self?.flushPendingPlannedDivesContextOnStateQueue()
      self?.flushPendingAcknowledgementsOnStateQueue()
    }
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    stateQueue.async { [weak self] in
      self?.flushPendingPlannedDivesContextOnStateQueue()
    }
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    stateQueue.async { [weak self] in
      self?.enqueuePendingPayloadOnStateQueue(from: userInfo)
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    stateQueue.async { [weak self] in
      self?.enqueuePendingPayloadOnStateQueue(from: message)
    }
  }

  func session(_ session: WCSession, didReceive file: WCSessionFile) {
    performOnStateQueueSync { [weak self] in
      guard let self,
            let metadata = file.metadata,
            metadata[WatchConnectivityEnvelopeKey.kind] as? String == WatchConnectivityEnvelopeValue.kind else {
        return
      }
      guard let payload = try? self.measureSlowStage(
        "watch-import",
        operation: {
          try self.persistPendingFile(
            sourceURL: file.fileURL,
            metadata: metadata
          )
        }
      ) else {
        return
      }
      self.enqueuePendingPayloadOnStateQueue(payload)
    }
  }

  private func enqueuePendingPayloadOnStateQueue(from userInfo: [String: Any]) {
    guard let payload = makePendingPayload(from: userInfo) else {
      return
    }

    enqueuePendingPayloadOnStateQueue(payload)
  }

  private func enqueuePendingPayloadOnStateQueue(
    _ payload: PendingWatchConnectivityPayload
  ) {
    if pendingPayloads.contains(where: {
      $0.localSessionId == payload.localSessionId
        && $0.contentRevision == payload.contentRevision
        && $0.sha256 == payload.sha256
    }) {
      payload.ownedFilePaths.forEach {
        try? FileManager.default.removeItem(atPath: $0)
      }
      return
    }
    pendingPayloads.append(payload)
    persistPendingPayloads()
    let dictionary = measureSlowStage("watch-import") {
      payload.descriptorDictionary
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      NotificationCenter.default.post(
        name: .diveWatchSyncPayloadReceived,
        object: self,
        userInfo: dictionary
      )
    }
  }

  private func makePendingPayload(from userInfo: [String: Any]) -> PendingWatchConnectivityPayload? {
    guard userInfo[WatchConnectivityEnvelopeKey.kind] as? String == WatchConnectivityEnvelopeValue.kind,
          let payloadBase64 = userInfo[WatchConnectivityEnvelopeKey.payloadBase64] as? String,
          let payloadData = Data(base64Encoded: payloadBase64) else {
      return nil
    }
    return try? persistPendingData(payloadData, metadata: userInfo)
  }

  private func acknowledgeOnStateQueue(payloadIds: [String]) {
    let payloadIdSet = Set(payloadIds)
    guard !payloadIdSet.isEmpty else {
      return
    }

    let removed = pendingPayloads.filter { payloadIdSet.contains($0.payloadId) }
    pendingPayloads.removeAll { payloadIdSet.contains($0.payloadId) }
    persistPendingPayloads()
    removed.flatMap(\.ownedFilePaths).forEach {
      try? FileManager.default.removeItem(atPath: $0)
    }
  }

  private func preparePendingPayloadOnStateQueue(
    payloadId: String,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    guard let payload = pendingPayloads.first(where: {
      $0.payloadId == payloadId
    }) else {
      completion(.failure(WatchPayloadPreparationError.unavailable))
      return
    }

    preparationQueue.async { [weak self] in
      guard let self else {
        completion(.failure(WatchPayloadPreparationError.unavailable))
        return
      }

      do {
        let prepared = try Self.prepare(payload: payload)
        self.stateQueue.async {
          guard let index = self.pendingPayloads.firstIndex(where: {
            $0.payloadId == payloadId
          }) else {
            try? FileManager.default.removeItem(
              atPath: prepared.preparedProfileFilePath
            )
            completion(.failure(WatchPayloadPreparationError.unavailable))
            return
          }

          self.pendingPayloads[index].preparedProfileFilePath =
            prepared.preparedProfileFilePath
          self.pendingPayloads[index].preparedProfileSha256 =
            prepared.preparedProfileSha256
          self.pendingPayloads[index].preparedProfileByteCount =
            prepared.preparedProfileByteCount
          self.pendingPayloads[index].preparedProfileSampleCount =
            prepared.preparedProfileSampleCount
          self.persistPendingPayloads()
          completion(.success(
            self.pendingPayloads[index].preparedDictionary(
              payloadJson: prepared.payloadJson
            )
          ))
        }
      } catch let error as WatchPayloadPreparationError {
        completion(.failure(error))
      } catch {
        completion(.failure(WatchPayloadPreparationError.io(error)))
      }
    }
  }

  private static func prepare(
    payload: PendingWatchConnectivityPayload
  ) throws -> PreparedWatchConnectivityArtifact {
    let data: Data
    do {
      data = try payload.artifactData()
    } catch {
      throw WatchPayloadPreparationError.io(error)
    }
    let decodedMessage: Any
    do {
      decodedMessage = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw WatchPayloadPreparationError.invalidPayload
    }
    guard (payload.byteCount == nil || payload.byteCount == data.count),
          (payload.sha256 == nil || payload.sha256 == sha256Hex(data)),
          var message = decodedMessage as? [String: Any],
          var session = message["session"] as? [String: Any],
          let localSessionId = session["localSessionId"] as? String,
          let samples = session["samples"] as? [[String: Any]],
          payload.localSessionId == nil || payload.localSessionId == localSessionId,
          payload.sampleCount == nil || payload.sampleCount == samples.count else {
      throw WatchPayloadPreparationError.invalidPayload
    }
    let profile = session["profile"] as? [String: Any]
    guard (profile?["sampleCount"] == nil ||
            profile?["sampleCount"] as? Int == samples.count),
          (payload.contentRevision == nil ||
            payload.contentRevision == profile?["contentRevision"] as? String)
    else {
      throw WatchPayloadPreparationError.invalidPayload
    }
    try validate(samples: samples, localSessionId: localSessionId)

    let profileData = try canonicalProfileData(samples)
    let preparedProfileSha256 = sha256Hex(profileData)
    let preparedProfileFilePath = preparedProfileURL(
      payloadId: payload.payloadId
    ).path
    do {
      try FileManager.default.createDirectory(
        at: inboxDirectoryURL(),
        withIntermediateDirectories: true
      )
      try profileData.write(
        to: URL(fileURLWithPath: preparedProfileFilePath),
        options: .atomic
      )
    } catch {
      throw WatchPayloadPreparationError.io(error)
    }

    session["samples"] = makePeakPreservingPreview(samples, limit: 160)
    message["session"] = session
    let previewData: Data
    do {
      previewData = try JSONSerialization.data(withJSONObject: message)
    } catch {
      throw WatchPayloadPreparationError.invalidPayload
    }
    guard let payloadJson = String(data: previewData, encoding: .utf8) else {
      throw WatchPayloadPreparationError.invalidPayload
    }

    return PreparedWatchConnectivityArtifact(
      payloadJson: payloadJson,
      preparedProfileFilePath: preparedProfileFilePath,
      preparedProfileSha256: preparedProfileSha256,
      preparedProfileByteCount: profileData.count,
      preparedProfileSampleCount: samples.count
    )
  }

  private static func validate(
    samples: [[String: Any]],
    localSessionId: String
  ) throws {
    let allowedSampleKeys = Set([
      "localSessionId",
      "timestamp",
      "depthMeters",
      "pressureKPa",
      "bucketMinDepthMeters",
      "bucketMaxDepthMeters",
      "waterTemperatureCelsius"
    ])
    for sample in samples {
      guard Set(sample.keys).isSubset(of: allowedSampleKeys),
            sample["localSessionId"] as? String == localSessionId,
            numericValue(sample["timestamp"]) != nil,
            numericValue(sample["depthMeters"]) != nil else {
        throw WatchPayloadPreparationError.invalidPayload
      }
      for key in [
        "pressureKPa",
        "bucketMinDepthMeters",
        "bucketMaxDepthMeters",
        "waterTemperatureCelsius"
      ] where sample[key] != nil {
        guard let number = numericValue(sample[key]) else {
          throw WatchPayloadPreparationError.invalidPayload
        }
        if key == "bucketMinDepthMeters" ||
          key == "bucketMaxDepthMeters" {
          guard number >= 0 else {
            throw WatchPayloadPreparationError.invalidPayload
          }
        }
      }
    }
  }

  private static func canonicalProfileData(
    _ samples: [[String: Any]]
  ) throws -> Data {
    let sourceData = try JSONSerialization.data(withJSONObject: samples)
    guard let sourceJSON = String(data: sourceData, encoding: .utf8),
          let context = JSContext() else {
      throw CocoaError(.fileReadCorruptFile)
    }
    context.setObject(
      sourceJSON,
      forKeyedSubscript: "profileJSON" as NSString
    )
    let result = context.evaluateScript(
      """
      (() => {
        const samples = JSON.parse(profileJSON);
        return JSON.stringify(samples.map(sample => {
          const canonical = {
            localSessionId: sample.localSessionId,
            timestamp: sample.timestamp,
            depthMeters: sample.depthMeters,
          };
          for (const key of [
            "pressureKPa",
            "bucketMinDepthMeters",
            "bucketMaxDepthMeters",
            "waterTemperatureCelsius",
          ]) {
            if (Object.prototype.hasOwnProperty.call(sample, key)) {
              canonical[key] = sample[key];
            }
          }
          return canonical;
        }));
      })()
      """
    )
    guard context.exception == nil,
          let encoded = result?.toString(),
          let data = encoded.data(using: .utf8) else {
      throw CocoaError(.fileReadCorruptFile)
    }
    return data
  }

  private static func numericValue(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite else {
      return nil
    }
    return number.doubleValue
  }

  private static func makePeakPreservingPreview(
    _ samples: [[String: Any]],
    limit: Int
  ) -> [[String: Any]] {
    guard limit > 0, samples.count > limit else {
      return samples
    }
    if limit == 1 {
      return [samples.max(by: {
        depth(from: $0) < depth(from: $1)
      }) ?? samples[0]]
    }

    var preview: [[String: Any]] = [samples[0]]
    let interiorLimit = limit - 2
    let interiorCount = samples.count - 2
    if interiorLimit > 0, interiorCount > 0 {
      for bucket in 0..<interiorLimit {
        let start = 1 + (bucket * interiorCount / interiorLimit)
        let end = 1 + ((bucket + 1) * interiorCount / interiorLimit)
        guard start < end else { continue }
        let peak = samples[start..<end].max {
          depth(from: $0) < depth(from: $1)
        }
        if let peak {
          preview.append(peak)
        }
      }
    }
    preview.append(samples[samples.count - 1])
    return Array(preview.prefix(limit))
  }

  private static func depth(from sample: [String: Any]) -> Double {
    (sample["bucketMaxDepthMeters"] as? NSNumber)?.doubleValue
      ?? (sample["depthMeters"] as? NSNumber)?.doubleValue
      ?? 0
  }

  private func acknowledgeImportedOnStateQueue(payloadIds: [String]) {
    let payloadIdSet = Set(payloadIds)
    guard !payloadIdSet.isEmpty else {
      return
    }

    let importedPayloads = pendingPayloads
      .filter { payloadIdSet.contains($0.payloadId) }

    enqueueImportAcknowledgements(payloads: importedPayloads)
    acknowledgeOnStateQueue(payloadIds: payloadIds)
  }

  private func enqueueImportAcknowledgements(payloads: [PendingWatchConnectivityPayload]) {
    for payload in payloads {
      guard let localSessionId = payload.localSessionId,
            let contentRevision = payload.contentRevision,
            let sha256 = payload.sha256 else { continue }
      let acknowledgement = PendingWatchConnectivityAcknowledgement(
        localSessionId: localSessionId,
        contentRevision: contentRevision,
        sha256: sha256,
        byteCount: payload.byteCount,
        sampleCount: payload.sampleCount,
        acknowledgedAt: Date().timeIntervalSince1970
      )
      if !pendingAcknowledgements.contains(where: {
        $0.localSessionId == acknowledgement.localSessionId
          && $0.contentRevision == acknowledgement.contentRevision
          && $0.sha256 == acknowledgement.sha256
      }) {
        pendingAcknowledgements.append(acknowledgement)
      }
    }
    persistPendingAcknowledgements()
    flushPendingAcknowledgementsOnStateQueue()
  }

  private func flushPendingAcknowledgementsOnStateQueue() {
    guard let connectivitySession,
          connectivitySession.activationState == .activated else { return }
    let outstandingIdentities = Set(connectivitySession.outstandingUserInfoTransfers.compactMap {
      PendingWatchConnectivityAcknowledgement.identity(from: $0.userInfo)
    })
    for acknowledgement in pendingAcknowledgements where !outstandingIdentities.contains(acknowledgement.identity) {
      let dictionary = acknowledgement.dictionary
      if connectivitySession.isReachable {
        connectivitySession.sendMessage(dictionary, replyHandler: nil) { _ in }
      }
      connectivitySession.transferUserInfo(dictionary)
    }
  }

  func session(
    _ session: WCSession,
    didFinish userInfoTransfer: WCSessionUserInfoTransfer,
    error: Error?
  ) {
    stateQueue.async { [weak self] in
      guard error == nil,
            let identity = PendingWatchConnectivityAcknowledgement.identity(
              from: userInfoTransfer.userInfo
            ) else {
        return
      }
      self?.pendingAcknowledgements.removeAll { $0.identity == identity }
      self?.persistPendingAcknowledgements()
    }
  }

  private func updatePlannedDivesOnStateQueue(
    json plannedDivesJson: String
  ) -> [String: Any] {
    pendingPlannedDivesJson = plannedDivesJson
    userDefaults.set(plannedDivesJson, forKey: Self.plannedDivesContextStorageKey)
    flushPendingPlannedDivesContextOnStateQueue()
    return plannedDivesStatusOnStateQueue(
      payloadCount: Self.countPlannedDives(in: plannedDivesJson)
    )
  }

  private func flushPendingPlannedDivesContextOnStateQueue() {
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

  private func linkedWatchInfoOnStateQueue() -> [String: Any] {
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

  private func plannedDivesStatusOnStateQueue(payloadCount: Int) -> [String: Any] {
    var status = linkedWatchInfoOnStateQueue()
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

  private func persistPendingAcknowledgements() {
    userDefaults.set(try? JSONEncoder().encode(pendingAcknowledgements), forKey: Self.acknowledgementStorageKey)
  }

  private static func loadPendingAcknowledgements(
    from userDefaults: UserDefaults
  ) -> [PendingWatchConnectivityAcknowledgement] {
    guard let data = userDefaults.data(forKey: acknowledgementStorageKey) else { return [] }
    return (try? JSONDecoder().decode([PendingWatchConnectivityAcknowledgement].self, from: data)) ?? []
  }

  private func persistPendingFile(
    sourceURL: URL,
    metadata: [String: Any]
  ) throws -> PendingWatchConnectivityPayload {
    try persistPendingData(Data(contentsOf: sourceURL), metadata: metadata, requiresIntegrityMetadata: true)
  }

  private func persistPendingData(
    _ data: Data,
    metadata: [String: Any],
    requiresIntegrityMetadata: Bool = false
  ) throws -> PendingWatchConnectivityPayload {
    let suppliedByteCount = metadata[WatchConnectivityEnvelopeKey.byteCount] as? Int
    let suppliedDigest = metadata[WatchConnectivityEnvelopeKey.sha256] as? String
    let suppliedSessionId = metadata[WatchConnectivityEnvelopeKey.localSessionId] as? String
    let suppliedRevision = metadata[WatchConnectivityEnvelopeKey.contentRevision] as? String
    if requiresIntegrityMetadata && (
      suppliedByteCount == nil || suppliedDigest == nil || suppliedSessionId == nil || suppliedRevision == nil
    ) {
      throw CocoaError(.fileReadCorruptFile)
    }
    let expectedByteCount = suppliedByteCount ?? data.count
    let expectedDigest = suppliedDigest ?? Self.sha256Hex(data)
    guard data.count == expectedByteCount, Self.sha256Hex(data) == expectedDigest else {
      throw CocoaError(.fileReadCorruptFile)
    }
    let message = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    let session = message?["session"] as? [String: Any]
    let bodyProfile = session?["profile"] as? [String: Any]
    if requiresIntegrityMetadata && (
      session?["localSessionId"] as? String != suppliedSessionId
        || bodyProfile?["contentRevision"] as? String != suppliedRevision
        || bodyProfile?["sampleCount"] as? Int != metadata[WatchConnectivityEnvelopeKey.sampleCount] as? Int
    ) {
      throw CocoaError(.fileReadCorruptFile)
    }
    let payloadId = UUID().uuidString
    let directory = Self.inboxDirectoryURL()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let fileURL = directory.appendingPathComponent("\(payloadId).json")
    try data.write(to: fileURL, options: .atomic)
    return PendingWatchConnectivityPayload(
      payloadId: payloadId,
      filePath: fileURL.path,
      payloadJson: nil,
      localSessionId: metadata[WatchConnectivityEnvelopeKey.localSessionId] as? String,
      contentRevision: metadata[WatchConnectivityEnvelopeKey.contentRevision] as? String,
      sha256: expectedDigest,
      byteCount: data.count,
      sampleCount: metadata[WatchConnectivityEnvelopeKey.sampleCount] as? Int,
      receivedAt: Date().timeIntervalSince1970,
      preparedProfileFilePath: nil,
      preparedProfileSha256: nil,
      preparedProfileByteCount: nil,
      preparedProfileSampleCount: nil
    )
  }

  private func performOnStateQueueSync(_ operation: () -> Void) {
    if DispatchQueue.getSpecific(key: stateQueueKey) != nil {
      operation()
      return
    }
    stateQueue.sync(execute: operation)
  }

  private func measureSlowStage<T>(
    _ label: StaticString,
    operation: () throws -> T
  ) rethrows -> T {
    #if DEBUG
    let startedAt = CFAbsoluteTimeGetCurrent()
    defer {
      let durationMs = (CFAbsoluteTimeGetCurrent() - startedAt) * 1_000
      if durationMs >= 100 {
        print("[performance] \(label) \(Int(durationMs.rounded()))ms")
      }
    }
    #endif
    return try operation()
  }

  private static func inboxDirectoryURL() -> URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return base.appendingPathComponent("Divenary/WatchConnectivityInbox", isDirectory: true)
  }

  private static func preparedProfileURL(payloadId: String) -> URL {
    inboxDirectoryURL().appendingPathComponent("\(payloadId).profile.json")
  }

  private static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

private struct PendingWatchConnectivityPayload: Codable {
  let payloadId: String
  let filePath: String?
  let payloadJson: String?
  let localSessionId: String?
  let contentRevision: String?
  let sha256: String?
  let byteCount: Int?
  let sampleCount: Int?
  let receivedAt: TimeInterval
  var preparedProfileFilePath: String?
  var preparedProfileSha256: String?
  var preparedProfileByteCount: Int?
  var preparedProfileSampleCount: Int?

  var descriptorDictionary: [String: Any] {
    var payload: [String: Any] = [
      "payloadId": payloadId,
      "receivedAt": receivedAt
    ]

    if let localSessionId {
      payload["localSessionId"] = localSessionId
    }
    if let contentRevision { payload["contentRevision"] = contentRevision }
    if let sha256 { payload["sha256"] = sha256 }

    return payload
  }

  func preparedDictionary(payloadJson: String) -> [String: Any] {
    var payload = descriptorDictionary
    payload["payloadJson"] = payloadJson
    if let preparedProfileSha256,
       let preparedProfileByteCount,
       let preparedProfileSampleCount {
      payload["preparedProfile"] = [
        "payloadId": payloadId,
        "sampleCount": preparedProfileSampleCount,
        "byteCount": preparedProfileByteCount,
        "sha256": preparedProfileSha256
      ]
    }
    return payload
  }

  var ownedFilePaths: [String] {
    [filePath, preparedProfileFilePath].compactMap { $0 }
  }

  func artifactData() throws -> Data {
    if let payloadJson {
      guard let data = payloadJson.data(using: .utf8) else {
        throw CocoaError(.fileReadInapplicableStringEncoding)
      }
      return data
    }
    guard let filePath else {
      throw CocoaError(.fileNoSuchFile)
    }
    return try Data(contentsOf: URL(fileURLWithPath: filePath))
  }
}

private struct PreparedWatchConnectivityArtifact {
  let payloadJson: String
  let preparedProfileFilePath: String
  let preparedProfileSha256: String
  let preparedProfileByteCount: Int
  let preparedProfileSampleCount: Int
}

enum WatchPayloadPreparationError: Error {
  case unavailable
  case invalidPayload
  case io(Error)
}

private struct PendingWatchConnectivityAcknowledgement: Codable, Equatable {
  let localSessionId: String
  let contentRevision: String
  let sha256: String
  let byteCount: Int?
  let sampleCount: Int?
  let acknowledgedAt: TimeInterval

  var identity: String { "\(localSessionId):\(contentRevision):\(sha256)" }

  static func identity(from dictionary: [String: Any]) -> String? {
    guard dictionary[WatchConnectivityEnvelopeKey.kind] as? String == WatchConnectivityEnvelopeValue.acknowledgementKind,
          let sessionId = dictionary[WatchConnectivityEnvelopeKey.localSessionId] as? String,
          let revision = dictionary[WatchConnectivityEnvelopeKey.contentRevision] as? String,
          let digest = dictionary[WatchConnectivityEnvelopeKey.sha256] as? String else { return nil }
    return "\(sessionId):\(revision):\(digest)"
  }

  var dictionary: [String: Any] {
    var value: [String: Any] = [
      WatchConnectivityEnvelopeKey.kind: WatchConnectivityEnvelopeValue.acknowledgementKind,
      WatchConnectivityEnvelopeKey.localSessionId: localSessionId,
      WatchConnectivityEnvelopeKey.contentRevision: contentRevision,
      WatchConnectivityEnvelopeKey.sha256: sha256,
      WatchConnectivityEnvelopeKey.acknowledgedAt: acknowledgedAt
    ]
    if let byteCount { value[WatchConnectivityEnvelopeKey.byteCount] = byteCount }
    if let sampleCount { value[WatchConnectivityEnvelopeKey.sampleCount] = sampleCount }
    return value
  }
}

private typealias UpdateApplicationContextIMP = @convention(c) (
  AnyObject,
  Selector,
  NSDictionary,
  AutoreleasingUnsafeMutablePointer<NSError?>
) -> Bool

private let PlannedDivesContextUpdateErrorDomain = "DivenaryWatchConnectivity.PlannedDivesContext"

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
  static let contentRevision = "contentRevision"
  static let sha256 = "sha256"
  static let byteCount = "byteCount"
  static let sampleCount = "sampleCount"
}

private enum WatchConnectivityEnvelopeValue {
  static let kind = "watchSyncMessage"
  static let acknowledgementKind = "watchSyncAcknowledgement"
  static let plannedDivesKind = "watchPlannedDives"
}
