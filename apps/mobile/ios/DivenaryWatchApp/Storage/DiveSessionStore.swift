import Combine
import Foundation

@MainActor
final class DiveSessionStore: ObservableObject {
    @Published private(set) var sessions: [DiveSessionRecord] = []
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
        loadPlannedDives()
        self.syncTransport.onTransferStatusChanged = { [weak self] artifact, syncStatus in
            Task { @MainActor in
                self?.updateSyncStatus(for: artifact, to: syncStatus)
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
        try? profileStore.updateDisplayRecord(displayRecord)
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
        // Interrupted-recording recovery waits for the next launch so it cannot touch a live recording.
        if let entries = try? profileStore.loadEntries() {
            sessions = entries.map(\.displayRecord)
        }
        return true
    }

    func updatePreferredDiveMode(_ nextDiveMode: DiveMode) {
        preferredDiveMode = nextDiveMode
        userDefaults.set(nextDiveMode.rawValue, forKey: Self.preferredDiveModeStorageKey)
    }

    private func updateSyncStatus(for artifact: DiveProfileArtifactIdentity, to syncStatus: DiveSyncStatus) {
        guard deletionRecoverySucceeded,
              let entry = try? profileStore.loadEntries().first(where: {
            $0.id == artifact.localSessionId
                && $0.artifact.contentRevision == artifact.contentRevision
                && $0.artifact.sha256 == artifact.sha256
        }), let index = sessions.firstIndex(where: { $0.id == artifact.localSessionId }) else {
            return
        }

        let effectiveStatus: DiveSyncStatus
        if syncStatus == .failed, sessions[index].syncStatus == .synced {
            effectiveStatus = .synced
        } else {
            effectiveStatus = syncStatus
        }

        sessions[index] = sessions[index].withSyncStatus(effectiveStatus).sanitizedForPersistence()
        try? profileStore.updateDisplayRecord(entry.displayRecord.withSyncStatus(effectiveStatus))
    }

    /// Sends one saved session again after its transfer failed.
    func retrySync(sessionID: UUID) {
        guard resumePendingDeletionsIfNeeded(),
              let entry = try? profileStore.loadEntries().first(where: { $0.id == sessionID }),
              entry.displayRecord.syncStatus != .synced else {
            return
        }
        let syncStatus = syncTransport.enqueue(
            artifact: entry.artifact,
            fileURL: profileStore.artifactURL(for: entry.artifact)
        )
        updateSyncStatus(for: entry.artifact, to: syncStatus)
    }

    private func retryPendingSyncs() {
        guard deletionRecoverySucceeded,
              let entries = try? profileStore.loadEntries() else { return }
        for entry in entries {
            guard entry.displayRecord.syncStatus != .synced else {
                continue
            }
            let syncStatus = syncTransport.enqueue(
                artifact: entry.artifact,
                fileURL: profileStore.artifactURL(for: entry.artifact)
            )
            updateSyncStatus(for: entry.artifact, to: syncStatus)
        }
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
            sessions = []
            return
        }
        defer { recoverInterruptedRecordings() }
        if fileManager.fileExists(atPath: recordsStorageURL.path) {
            do {
                sessions = try profileStore.migrateLegacyRecords(at: recordsStorageURL)
                    .map(\.displayRecord)
            } catch {
                sessions = (try? profileStore.loadEntries().map(\.displayRecord)) ?? []
            }
            return
        }

        if let entries = try? profileStore.loadEntries(), !entries.isEmpty {
            sessions = entries.map(\.displayRecord)
            return
        }

        if let data = userDefaults.data(forKey: storageKey) {
            do {
                let records = try JSONDecoder().decode([DiveSessionRecord].self, from: data)
                sessions = try records.map { try profileStore.finalize(record: $0).displayRecord }
                    .sorted { $0.startedAt > $1.startedAt }
                userDefaults.removeObject(forKey: storageKey)
            } catch {
                sessions = []
                userDefaults.removeObject(forKey: storageKey)
            }
            return
        }

        guard let legacyData = userDefaults.data(forKey: legacyStorageKey) else {
            sessions = []
            return
        }

        do {
            let legacySessions = try JSONDecoder().decode([DiveSession].self, from: legacyData)
            sessions = legacySessions
                .map(DiveSessionRecord.init(legacySession:))
                .map { $0.sanitizedForPersistence() }
                .sorted { $0.startedAt > $1.startedAt }
            sessions = try sessions.map { try profileStore.finalize(record: $0).displayRecord }
                .sorted { $0.startedAt > $1.startedAt }
        } catch {
            sessions = []
        }
    }

    private func recoverInterruptedRecordings() {
        guard deletionRecoverySucceeded,
              let recordings = try? profileStore.loadActiveRecordings() else { return }
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
