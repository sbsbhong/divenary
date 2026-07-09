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
    private var executedPlanIds = Set<String>()

    init(
        userDefaults: UserDefaults = .standard,
        syncTransport: WatchSyncTransporting = WatchSyncTransport(),
        recordsStorageURL: URL? = nil,
        fileManager: FileManager = .default
    ) {
        self.userDefaults = userDefaults
        self.syncTransport = syncTransport
        self.fileManager = fileManager
        self.recordsStorageURL = recordsStorageURL ?? Self.defaultRecordsStorageURL(fileManager: fileManager)
        preferredDiveMode = Self.loadPreferredDiveMode(from: userDefaults)
        load()
        loadPlannedDives()
        self.syncTransport.onTransferStatusChanged = { [weak self] sessionId, syncStatus in
            Task { @MainActor in
                self?.updateSyncStatus(for: sessionId, to: syncStatus)
            }
        }
        self.syncTransport.onActivationCompleted = { [weak self] in
            Task { @MainActor in
                self?.retryPendingSyncs()
            }
        }
        self.syncTransport.onPlannedDivesChanged = { [weak self] plannedDives in
            Task { @MainActor in
                self?.replacePlannedDives(plannedDives)
            }
        }
        syncTransport.activate()
    }

    func save(_ session: DiveSessionRecord) {
        let safeSession = session.sanitizedForPersistence()
        let syncStatus = syncTransport.enqueue(session: safeSession)
        sessions.insert(safeSession.withSyncStatus(syncStatus), at: 0)
        if let sourcePlanLocalId = safeSession.resolvedSourcePlanLocalId {
            markPlanExecuted(sourcePlanLocalId)
        }
        persist()
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
        syncTransport.refreshPlannedDives()
        retryPendingSyncs()
    }

    func updatePreferredDiveMode(_ nextDiveMode: DiveMode) {
        preferredDiveMode = nextDiveMode
        userDefaults.set(nextDiveMode.rawValue, forKey: Self.preferredDiveModeStorageKey)
    }

    private func updateSyncStatus(for sessionId: UUID, to syncStatus: DiveSyncStatus) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else {
            return
        }

        guard !(syncStatus == .failed && sessions[index].syncStatus == .synced) else {
            return
        }

        sessions[index] = sessions[index].withSyncStatus(syncStatus).sanitizedForPersistence()
        persist()
    }

    private func retryPendingSyncs() {
        var didUpdate = false

        for index in sessions.indices {
            let session = sessions[index].sanitizedForPersistence()
            guard session.syncStatus != .synced else {
                continue
            }

            let syncStatus = syncTransport.enqueue(session: session)
            sessions[index] = session.withSyncStatus(syncStatus).sanitizedForPersistence()
            didUpdate = true
        }

        if didUpdate {
            persist()
        }
    }

    private func load() {
        if fileManager.fileExists(atPath: recordsStorageURL.path) {
            do {
                let data = try Data(contentsOf: recordsStorageURL)
                sessions = try JSONDecoder().decode([DiveSessionRecord].self, from: data)
                    .map { $0.sanitizedForPersistence() }
                    .sorted { $0.startedAt > $1.startedAt }
            } catch {
                sessions = []
                try? fileManager.removeItem(at: recordsStorageURL)
            }
            return
        }

        if let data = userDefaults.data(forKey: storageKey) {
            do {
                sessions = try JSONDecoder().decode([DiveSessionRecord].self, from: data)
                    .map { $0.sanitizedForPersistence() }
                    .sorted { $0.startedAt > $1.startedAt }
                if persist() {
                    userDefaults.removeObject(forKey: storageKey)
                }
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
            _ = persist()
        } catch {
            sessions = []
        }
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

    @discardableResult
    private func persist() -> Bool {
        do {
            let data = try JSONEncoder().encode(sessions)
            try fileManager.createDirectory(
                at: recordsStorageURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: recordsStorageURL, options: .atomic)
            userDefaults.removeObject(forKey: storageKey)
            return true
        } catch {
            assertionFailure("Failed to save dive sessions: \(error)")
            return false
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
            .appendingPathComponent("DiveWatchApp", isDirectory: true)
            .appendingPathComponent("savedDiveSessionRecords.json")
    }
}

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
