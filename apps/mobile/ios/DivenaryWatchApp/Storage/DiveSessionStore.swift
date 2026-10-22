import Combine
import Foundation

enum DiveHistoryReadState: Equatable {
    case loaded
    case failed
}

@MainActor
final class DiveSessionStore: ObservableObject {
    @Published private(set) var sessions: [DiveSessionRecord] = []
    @Published private(set) var historyReadState: DiveHistoryReadState = .loaded
    @Published private(set) var syncRetryFeedback: [UUID: String] = [:]
    private var syncRetryAttempts: [UUID: Int] = [:]
    @Published private(set) var plannedDives: [WatchPlannedDive] = []
    @Published var preferredDiveMode: DiveMode

    private let storageKey = "savedDiveSessionRecords"
    private let legacyStorageKey = "savedDiveSessions"
    private let plannedDivesStorageKey = "savedWatchPlannedDives"
    private let executedPlanIdsStorageKey = "executedWatchPlanIds"
    private static let preferredDiveModeStorageKey = "preferredDiveMode"
    private let syncTransport: WatchSyncTransporting
    private let userDefaults: UserDefaults
    private let fileManager: FileManager
    private let recordsStorageURL: URL
    private let profileStore: DiveProfileArtifactStore
    private var deletionRecoverySucceeded = false
    private var executedPlanIds = Set<String>()

    init(
        userDefaults: UserDefaults = .standard,
        syncTransport: WatchSyncTransporting = WatchSyncTransport(),
        recordsStorageURL: URL? = nil,
        fileManager: FileManager = .default,
        profileStore: DiveProfileArtifactStore? = nil
    ) {
        self.userDefaults = userDefaults
        self.syncTransport = syncTransport
        self.fileManager = fileManager
        self.recordsStorageURL = recordsStorageURL ?? Self.defaultRecordsStorageURL(fileManager: fileManager)
        self.profileStore = profileStore ?? DiveProfileArtifactStore(
            rootURL: (recordsStorageURL ?? Self.defaultRecordsStorageURL(fileManager: fileManager))
                .deletingLastPathComponent(),
            fileManager: fileManager
        )
        preferredDiveMode = Self.loadPreferredDiveMode(from: userDefaults)
        do {
            try self.profileStore.resumePendingDeletions()
            deletionRecoverySucceeded = true
        } catch {
            deletionRecoverySucceeded = false
        }
        load()
        recoverInterruptedRecordings()
        loadPlannedDives()
        self.syncTransport.onTransferStatusChanged = { [weak self] artifact, syncStatus in
            Task { @MainActor in
                self?.applySyncStatuses([(artifact, syncStatus)])
            }
        }
        self.syncTransport.onActivationCompleted = { [weak self] in
            Task { @MainActor in
                self?.resumePendingDeletionsIfNeeded()
                self?.retryPendingSyncs()
            }
        }
        self.syncTransport.onPlannedDivesChanged = { [weak self] plannedDives in
            Task { @MainActor in
                self?.replacePlannedDives(plannedDives)
            }
        }
        self.syncTransport.onSessionDeletionRequested = { [weak self] command in
            Task { @MainActor in
                self?.handleSessionDeletion(command)
            }
        }
        syncTransport.activate()
    }

    @discardableResult
    func save(_ session: DiveSessionRecord) -> Bool {
        guard resumePendingDeletionsIfNeeded() else {
            return false
        }
        let safeSession = session.sanitizedForPersistence()
        let entry: DiveProfileManifestEntry
        do {
            entry = try finalizedEntry(for: safeSession, explicitProfile: session.profile)
            try profileStore.clearActiveRecording(sessionID: safeSession.id)
        } catch {
            assertionFailure("Failed to finalize dive profile: \(error)")
            return false
        }

        let syncStatus = syncTransport.enqueue(
            artifact: entry.artifact,
            fileURL: profileStore.artifactURL(for: entry.artifact)
        )
        let displayRecord = entry.displayRecord.withSyncStatus(syncStatus).sanitizedForPersistence()
        try? profileStore.updateSyncStatuses([displayRecord.id: syncStatus])
        sessions.removeAll { $0.id == displayRecord.id }
        sessions.insert(displayRecord, at: 0)
        // A demo recording never executes a real planned dive.
        if safeSession.captureMode == .real, let sourcePlanLocalId = safeSession.resolvedSourcePlanLocalId {
            markPlanExecuted(sourcePlanLocalId)
        }
        return true
    }

    private func finalizedEntry(
        for session: DiveSessionRecord,
        explicitProfile: DiveProfileMetadata?
    ) throws -> DiveProfileManifestEntry {
        guard deletionRecoverySucceeded else {
            throw CocoaError(.fileReadCorruptFile)
        }
        if let existingEntry = try profileStore.loadEntries().first(where: { $0.id == session.id }) {
            guard try profileStore.matchesCanonicalArtifact(
                for: session,
                existing: existingEntry.artifact,
                explicitProfile: explicitProfile
            ) else {
                throw CocoaError(.fileWriteFileExists)
            }
            return existingEntry
        }

        return try profileStore.finalize(record: session)
    }

    func replacePlannedDives(_ nextPlannedDives: [WatchPlannedDive]) {
        plannedDives = nextPlannedDives
            .filter { !executedPlanIds.contains($0.localId) }
            .sorted { ($0.plannedAt ?? Double.greatestFiniteMagnitude) < ($1.plannedAt ?? Double.greatestFiniteMagnitude) }
        persistPlannedDives()
    }

    func markPlanExecuted(_ localId: String) {
        executedPlanIds.insert(localId)
        plannedDives.removeAll { $0.localId == localId }
        persistExecutedPlanIds()
        persistPlannedDives()
    }

    func refreshFromCompanion() async {
        resumePendingDeletionsIfNeeded()
        syncTransport.refreshPlannedDives()
        retryPendingSyncs()
    }

    /// Retry unfinished startup recovery while excluding recordings begun in this process.
    func retryLoadingHistory() {
        guard resumePendingDeletionsIfNeeded() else {
            historyReadState = .failed
            return
        }
        load()
        recoverInterruptedRecordings()
    }

    /// Finishes deletions interrupted in an earlier run before any read or write, so a deleted
    /// session cannot come back. A launch-time failure is retried instead of blocking every save.
    @discardableResult
    func resumePendingDeletionsIfNeeded() -> Bool {
        guard !deletionRecoverySucceeded else {
            return true
        }
        do {
            try profileStore.resumePendingDeletions()
        } catch {
            return false
        }
        deletionRecoverySucceeded = true
        // History retry separately recovers only journals from earlier processes.
        if let entries = try? profileStore.loadEntries() {
            sessions = entries.map(\.displayRecord)
        }
        return true
    }

    func updatePreferredDiveMode(_ nextDiveMode: DiveMode) {
        preferredDiveMode = nextDiveMode
        userDefaults.set(nextDiveMode.rawValue, forKey: Self.preferredDiveModeStorageKey)
    }

    /// Applies transfer results in one pass: one `sessions` publish and at most one manifest write.
    /// A late failure never downgrades a session the phone already confirmed.
    private func applySyncStatuses(
        _ updates: [(artifact: DiveProfileArtifactIdentity, status: DiveSyncStatus)]
    ) {
        for (artifact, status) in updates {
            let effectiveStatus: DiveSyncStatus = sessions.first(where: { $0.id == artifact.localSessionId })?.syncStatus == .synced
                ? .synced : status
            updateSyncRetryFeedback(sessionID: artifact.localSessionId, status: effectiveStatus)
        }
        guard deletionRecoverySucceeded,
              !updates.isEmpty,
              let entries = try? profileStore.loadEntries() else {
            return
        }
        var nextSessions = sessions
        var persistedStatuses: [UUID: DiveSyncStatus] = [:]
        for (artifact, status) in updates {
            guard let entry = entries.first(where: {
                $0.id == artifact.localSessionId
                    && $0.artifact.contentRevision == artifact.contentRevision
                    && $0.artifact.sha256 == artifact.sha256
            }), let index = nextSessions.firstIndex(where: { $0.id == artifact.localSessionId }) else {
                continue
            }
            let effectiveStatus: DiveSyncStatus =
                status == .failed && nextSessions[index].syncStatus == .synced ? .synced : status
            if nextSessions[index].syncStatus != effectiveStatus {
                nextSessions[index] = nextSessions[index].withSyncStatus(effectiveStatus)
            }
            if entry.displayRecord.syncStatus != effectiveStatus {
                persistedStatuses[artifact.localSessionId] = effectiveStatus
            }
        }
        if nextSessions.map(\.syncStatus) != sessions.map(\.syncStatus) {
            sessions = nextSessions
        }
        if !persistedStatuses.isEmpty {
            try? profileStore.updateSyncStatuses(persistedStatuses)
        }
    }

    /// Sends one saved session again after its transfer failed.
    func retrySync(sessionID: UUID) {
        syncRetryAttempts[sessionID, default: 0] += 1
        guard resumePendingDeletionsIfNeeded(),
              let entry = try? profileStore.loadEntries().first(where: { $0.id == sessionID }) else {
            updateSyncRetryFeedback(sessionID: sessionID, status: .failed)
            return
        }
        guard entry.displayRecord.syncStatus != .synced else {
            updateSyncRetryFeedback(sessionID: sessionID, status: .synced)
            return
        }
        let syncStatus = syncTransport.enqueue(
            artifact: entry.artifact,
            fileURL: profileStore.artifactURL(for: entry.artifact)
        )
        applySyncStatuses([(entry.artifact, syncStatus)])
    }

    private func updateSyncRetryFeedback(sessionID: UUID, status: DiveSyncStatus) {
        guard let attempt = syncRetryAttempts[sessionID] else { return }
        if status == .failed {
            let message = String(localized: "Send failed. Try again.")
            syncRetryFeedback[sessionID] = String(localized: "\(message) (\(attempt))")
        } else {
            syncRetryFeedback[sessionID] = nil
        }
    }

    private func retryPendingSyncs() {
        guard deletionRecoverySucceeded,
              let entries = try? profileStore.loadEntries() else { return }
        let updates = entries
            .filter { $0.displayRecord.syncStatus != .synced }
            .map { entry in
                (
                    artifact: entry.artifact,
                    status: syncTransport.enqueue(
                        artifact: entry.artifact,
                        fileURL: profileStore.artifactURL(for: entry.artifact)
                    )
                )
            }
        applySyncStatuses(updates)
    }

    private func handleSessionDeletion(
        _ command: WatchSessionDeletionCommand
    ) {
        syncTransport.cancelTransfers(
            localSessionId: command.localSessionId
        )
        do {
            let removed = try profileStore.deleteSession(
                localSessionId: command.localSessionId
            )
            sessions.removeAll { $0.id == command.localSessionId }
            syncTransport.acknowledgeDeletion(
                WatchSessionDeletionResult(
                    commandId: command.commandId,
                    localSessionId: command.localSessionId,
                    acknowledgedAt: Date(),
                    outcome: removed == nil ? .alreadyAbsent : .deleted,
                    removedContentRevision: removed?.contentRevision,
                    removedArtifactSha256: removed?.artifactSha256
                )
            )
        } catch {
            assertionFailure(
                "Failed to delete Watch session \(command.localSessionId): \(error)"
            )
        }
    }

    private func load() {
        guard deletionRecoverySucceeded else {
            historyReadState = .failed
            return
        }
        historyReadState = .loaded
        if fileManager.fileExists(atPath: recordsStorageURL.path) {
            do {
                sessions = try profileStore.migrateLegacyRecords(at: recordsStorageURL)
                    .map(\.displayRecord)
            } catch {
                historyReadState = .failed
                if let entries = try? profileStore.loadEntries() {
                    sessions = entries.map(\.displayRecord)
                }
            }
            return
        }

        do {
            sessions = try profileStore.loadEntries().map(\.displayRecord)
        } catch {
            historyReadState = .failed
            return
        }

        if let data = userDefaults.data(forKey: storageKey) {
            do {
                let records = try JSONDecoder().decode([DiveSessionRecord].self, from: data)
                try migrateUserDefaultsRecords(records)
                userDefaults.removeObject(forKey: storageKey)
            } catch {
                historyReadState = .failed
            }
            return
        }

        guard let legacyData = userDefaults.data(forKey: legacyStorageKey) else {
            return
        }

        do {
            let legacySessions = try JSONDecoder().decode([DiveSession].self, from: legacyData)
            let records = legacySessions
                .map(DiveSessionRecord.init(legacySession:))
                .map { $0.sanitizedForPersistence() }
                .sorted { $0.startedAt > $1.startedAt }
            try migrateUserDefaultsRecords(records)
            userDefaults.removeObject(forKey: legacyStorageKey)
        } catch {
            historyReadState = .failed
        }
    }

    private func migrateUserDefaultsRecords(_ records: [DiveSessionRecord]) throws {
        var entries = try profileStore.loadEntries()
        for record in records {
            if try profileStore.isSessionDeleted(record.id) { continue }
            if let existing = entries.first(where: { $0.id == record.id }) {
                try profileStore.verifyArtifact(existing.artifact)
                guard try profileStore.matchesCanonicalArtifact(
                    for: record.sanitizedForPersistence(), existing: existing.artifact,
                    explicitProfile: record.profile
                ) else { throw CocoaError(.fileWriteFileExists) }
            } else {
                let entry = try profileStore.finalize(record: record)
                try profileStore.verifyArtifact(entry.artifact)
                entries.append(entry)
            }
        }
        // Publish and remove the source only after every artifact and the manifest can be read.
        sessions = try profileStore.loadEntries().map(\.displayRecord)
    }

    private func recoverInterruptedRecordings() {
        guard deletionRecoverySucceeded else { return }
        let recordings: [ActiveDiveRecording]
        do {
            recordings = try profileStore.loadActiveRecordings(excludingCurrentProcess: true)
            if profileStore.activeRecordingReadFailed { historyReadState = .failed }
        } catch {
            historyReadState = .failed
            return
        }
        for recording in recordings where !sessions.contains(where: { $0.id == recording.metadata.localSessionId }) {
            guard !recording.samples.isEmpty else { continue }
            let endedAt = recording.samples.last?.timestamp ?? recording.metadata.startedAt
            let payload: DiveSessionPayload
            switch recording.metadata.plan.diveMode {
            case .freedive:
                var engine = FreeDiveSessionEngine(startedAt: recording.metadata.startedAt)
                recording.samples.forEach { engine.append($0) }
                payload = .freedive(engine.finish(at: endedAt))
            case .scuba:
                var engine = ScubaDiveEngine(
                    startedAt: recording.metadata.startedAt,
                    gasLabel: recording.metadata.plan.gasLabel,
                    sessionID: recording.metadata.localSessionId
                )
                recording.samples.forEach { engine.append($0) }
                payload = .scuba(engine.finish(at: endedAt))
            }
            let plan = recording.metadata.plan
            let record = DiveSessionRecord(
                id: recording.metadata.localSessionId,
                schemaVersion: 3,
                captureMode: recording.metadata.captureMode,
                diveMode: plan.diveMode,
                siteId: nil,
                siteName: plan.siteName.isEmpty ? nil : plan.siteName,
                sourcePlanLocalId: plan.sourcePlanLocalId,
                planTitle: plan.title.isEmpty ? nil : plan.title,
                buddyIds: plan.buddyIds,
                gearIds: plan.gearIds,
                tags: plan.tags,
                notes: plan.quickNote.isEmpty ? nil : plan.quickNote,
                rating: nil,
                perceivedExertion: nil,
                visibilityRating: nil,
                waterCondition: .unknown,
                syncStatus: .pending,
                entryLocation: nil,
                exitLocation: nil,
                startedAt: recording.metadata.startedAt,
                endedAt: endedAt,
                samples: recording.samples,
                payload: payload,
                profile: DiveProfileMetadata(
                    contentRevision: UUID().uuidString,
                    sampleCount: recording.samples.count,
                    interrupted: true
                )
            )
            if let entry = try? profileStore.finalize(record: record) {
                sessions.append(entry.displayRecord)
                try? profileStore.clearActiveRecording(sessionID: record.id)
            } else {
                historyReadState = .failed
            }
        }
        sessions.sort { $0.startedAt > $1.startedAt }
    }

    private func loadPlannedDives() {
        if let executedPlanIds = userDefaults.array(forKey: executedPlanIdsStorageKey) as? [String] {
            self.executedPlanIds = Set(executedPlanIds)
        }

        guard let data = userDefaults.data(forKey: plannedDivesStorageKey) else {
            plannedDives = []
            return
        }

        do {
            let decodedPlannedDives = try JSONDecoder().decode([WatchPlannedDive].self, from: data)
            plannedDives = decodedPlannedDives.filter { !executedPlanIds.contains($0.localId) }
        } catch {
            plannedDives = []
            userDefaults.removeObject(forKey: plannedDivesStorageKey)
        }
    }

    private func persistPlannedDives() {
        do {
            let data = try JSONEncoder().encode(plannedDives)
            userDefaults.set(data, forKey: plannedDivesStorageKey)
        } catch {
            assertionFailure("Failed to save watch planned dives: \(error)")
        }
    }

    private func persistExecutedPlanIds() {
        userDefaults.set(Array(executedPlanIds), forKey: executedPlanIdsStorageKey)
    }

    private static func loadPreferredDiveMode(from userDefaults: UserDefaults) -> DiveMode {
        DiveMode.defaultingRemovedDiveModeToScuba(userDefaults.string(forKey: preferredDiveModeStorageKey))
    }

    private static func defaultRecordsStorageURL(fileManager: FileManager) -> URL {
        let baseURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        return baseURL
            .appendingPathComponent("DivenaryWatchApp", isDirectory: true)
            .appendingPathComponent("savedDiveSessionRecords.json")
    }
}

extension DiveSessionStore: DiveSessionPersisting {}

private extension DiveSessionRecord {
    var resolvedSourcePlanLocalId: String? {
        if let sourcePlanLocalId {
            return sourcePlanLocalId
        }

        return tags
            .first { $0.hasPrefix("plan-") }
            .map { String($0.dropFirst("plan-".count)) }
    }
}
