import Foundation
import WatchConnectivity

protocol WatchSyncTransporting: AnyObject {
    var onTransferStatusChanged: ((DiveProfileArtifactIdentity, DiveSyncStatus) -> Void)? { get set }
    var onActivationCompleted: (() -> Void)? { get set }
    var onPlannedDivesChanged: (([WatchPlannedDive]) -> Void)? { get set }
    var onSessionDeletionRequested: ((WatchSessionDeletionCommand) -> Void)? { get set }

    func activate()
    func enqueue(artifact: DiveProfileArtifactIdentity, fileURL: URL) -> DiveSyncStatus
    func cancelTransfers(localSessionId: UUID)
    func acknowledgeDeletion(_ result: WatchSessionDeletionResult)
    func refreshPlannedDives()
}

final class WatchSyncTransport: NSObject, WatchSyncTransporting, WCSessionDelegate {
    var onTransferStatusChanged: ((DiveProfileArtifactIdentity, DiveSyncStatus) -> Void)?
    var onActivationCompleted: (() -> Void)?
    var onPlannedDivesChanged: (([WatchPlannedDive]) -> Void)?
    var onSessionDeletionRequested: ((WatchSessionDeletionCommand) -> Void)?

    private let connectivitySession: WCSession?
    private let fileManager: FileManager

    override init() {
        connectivitySession = WCSession.isSupported() ? WCSession.default : nil
        fileManager = .default
        super.init()
        connectivitySession?.delegate = self
    }

    func activate() {
        connectivitySession?.activate()
    }

    func enqueue(artifact: DiveProfileArtifactIdentity, fileURL: URL) -> DiveSyncStatus {
        guard let connectivitySession else {
            return .failed
        }

        guard fileManager.fileExists(atPath: fileURL.path) else {
            return .failed
        }
        let alreadyOutstanding = connectivitySession.outstandingFileTransfers.contains { transfer in
            guard let metadata = transfer.file.metadata,
                  let outstanding = WatchSyncEnvelope.artifactIdentity(from: metadata) else {
                return false
            }
            return outstanding.localSessionId == artifact.localSessionId
                && outstanding.contentRevision == artifact.contentRevision
                && outstanding.sha256 == artifact.sha256
        }
        if !alreadyOutstanding {
            connectivitySession.transferFile(
                fileURL,
                metadata: WatchSyncEnvelope.fileMetadata(for: artifact)
            )
        }
        return .pending
    }

    func cancelTransfers(localSessionId: UUID) {
        guard let connectivitySession else {
            return
        }
        for fileTransfer in connectivitySession.outstandingFileTransfers {
            guard let metadata = fileTransfer.file.metadata,
                  let artifact = WatchSyncEnvelope.artifactIdentity(
                    from: metadata
                  ),
                  artifact.localSessionId == localSessionId else {
                continue
            }
            fileTransfer.cancel()
        }
    }

    func acknowledgeDeletion(_ result: WatchSessionDeletionResult) {
        guard let connectivitySession else {
            return
        }
        let acknowledgement = result.dictionary
        if connectivitySession.isReachable {
            connectivitySession.sendMessage(
                acknowledgement,
                replyHandler: nil
            ) { _ in }
        }
        connectivitySession.transferUserInfo(acknowledgement)
    }

    func refreshPlannedDives() {
        guard let connectivitySession else {
            return
        }

        handleReceivedApplicationContext(from: connectivitySession)
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        guard error == nil, activationState == .activated else {
            return
        }

        handleReceivedApplicationContext(from: session)
        notifyReadyToRetry()
    }

    func session(
        _ session: WCSession,
        didFinish fileTransfer: WCSessionFileTransfer,
        error: Error?
    ) {
        guard let metadata = fileTransfer.file.metadata,
              let artifact = WatchSyncEnvelope.artifactIdentity(from: metadata) else {
            return
        }
        guard error != nil else {
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.onTransferStatusChanged?(artifact, .failed)
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else {
            return
        }

        notifyReadyToRetry()
    }

    private func notifyReadyToRetry() {
        DispatchQueue.main.async { [weak self] in
            self?.onActivationCompleted?()
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard !handleSessionDeletion(userInfo: userInfo) else {
            return
        }
        guard !handlePlannedDives(userInfo: userInfo) else {
            return
        }

        handleAcknowledgement(userInfo: userInfo)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard !handleSessionDeletion(userInfo: message) else {
            return
        }
        guard !handlePlannedDives(userInfo: message) else {
            return
        }

        handleAcknowledgement(userInfo: message)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        _ = handlePlannedDives(userInfo: applicationContext)
    }

    private func handleReceivedApplicationContext(from session: WCSession) {
        _ = handlePlannedDives(userInfo: session.receivedApplicationContext)
    }

    private func handleAcknowledgement(userInfo: [String: Any]) {
        guard userInfo[WatchSyncEnvelope.kindKey] as? String == WatchSyncEnvelope.acknowledgementKind,
              let localSessionId = userInfo[WatchSyncEnvelope.localSessionIdKey] as? String,
              let sessionId = UUID(uuidString: localSessionId),
              let contentRevision = userInfo[WatchSyncEnvelope.contentRevisionKey] as? String,
              let sha256 = userInfo[WatchSyncEnvelope.sha256Key] as? String else {
            return
        }

        let artifact = DiveProfileArtifactIdentity(
            localSessionId: sessionId,
            contentRevision: contentRevision,
            sha256: sha256,
            byteCount: userInfo[WatchSyncEnvelope.byteCountKey] as? Int ?? 0,
            sampleCount: userInfo[WatchSyncEnvelope.sampleCountKey] as? Int ?? 0,
            relativePath: ""
        )

        DispatchQueue.main.async { [weak self] in
            self?.onTransferStatusChanged?(artifact, .synced)
        }
    }

    private func handleSessionDeletion(userInfo: [String: Any]) -> Bool {
        guard userInfo[WatchSyncEnvelope.kindKey] as? String
                == WatchSyncEnvelope.sessionDeletionCommandKind else {
            return false
        }
        guard let command = WatchSessionDeletionCommand(
            dictionary: userInfo
        ) else {
            return true
        }
        DispatchQueue.main.async { [weak self] in
            self?.onSessionDeletionRequested?(command)
        }
        return true
    }

    private func handlePlannedDives(userInfo: [String: Any]) -> Bool {
        guard userInfo[WatchSyncEnvelope.kindKey] as? String == WatchSyncEnvelope.plannedDivesKind,
              let plannedDivesJson = userInfo[WatchSyncEnvelope.plannedDivesJsonKey] as? String,
              let plannedDivesData = plannedDivesJson.data(using: .utf8),
              let plannedDives = try? JSONDecoder().decode([WatchPlannedDive].self, from: plannedDivesData) else {
            return false
        }

        DispatchQueue.main.async { [weak self] in
            self?.onPlannedDivesChanged?(plannedDives)
        }
        return true
    }
}
