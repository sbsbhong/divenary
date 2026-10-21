import CryptoKit
import Foundation

struct DiveProfileArtifactIdentity: Codable, Equatable, Hashable {
    let localSessionId: UUID
    let contentRevision: String
    let sha256: String
    let byteCount: Int
    let sampleCount: Int
    let relativePath: String
}

struct DiveProfileManifestEntry: Codable, Identifiable {
    let id: UUID
    var displayRecord: DiveSessionRecord
    let artifact: DiveProfileArtifactIdentity

    init(displayRecord: DiveSessionRecord, artifact: DiveProfileArtifactIdentity) {
        id = artifact.localSessionId
        self.displayRecord = displayRecord
        self.artifact = artifact
    }
}

struct CanonicalDiveProfileArtifact {
    let data: Data
    let identity: DiveProfileArtifactIdentity
}

struct DeletedDiveSessionArtifact: Equatable {
    let localSessionId: UUID
    let contentRevision: String
    let artifactSha256: String
}

struct ActiveDiveRecordingMetadata: Codable, Equatable {
    let localSessionId: UUID
    let startedAt: Date
    let captureMode: DiveCaptureMode
    let plan: PreDivePlan
}

struct ActiveDiveRecording {
    let metadata: ActiveDiveRecordingMetadata
    let samples: [DepthSample]
}

protocol DiveProfileRecordingStoring: AnyObject {
    func beginRecording(_ metadata: ActiveDiveRecordingMetadata) throws
    func append(_ sample: DepthSample, to sessionID: UUID) throws
    func clearActiveRecording(sessionID: UUID) throws
}

final class DiveProfileArtifactStore: DiveProfileRecordingStoring {
    private struct Manifest: Codable {
        let formatVersion: Int
        var entries: [DiveProfileManifestEntry]
    }

    private struct DeletedSessionLedger: Codable {
        let formatVersion: Int
        let sessionIds: [UUID]
    }

    /// Identifies one version of a file, so a decoded copy can be reused until the file changes.
    private struct FileStamp: Equatable {
        let modificationDate: Date
        let byteCount: Int
    }

    /// The recording journal of an active session, kept open while samples arrive.
    private final class OpenJournal {
        let handle: FileHandle
        /// Bytes known to hold complete sample lines. A failed write may leave bytes after it.
        var durableLength: UInt64
        var lastSample: DepthSample?
        var appendsSinceSync = 0

        init(handle: FileHandle, durableLength: UInt64, lastSample: DepthSample?) {
            self.handle = handle
            self.durableLength = durableLength
            self.lastSample = lastSample
        }
    }

    /// Samples arrive about once a second. Flushing to storage every few samples bounds what an
    /// OS crash can lose; an app crash loses nothing because written bytes stay in the OS cache.
    private static let appendsPerSync = 10

    private let rootURL: URL
    private let fileManager: FileManager
    private let makeRevision: () -> String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var cachedManifest: (stamp: FileStamp, entries: [DiveProfileManifestEntry])?
    private var cachedDeletedSessionIds: (stamp: FileStamp, sessionIds: Set<UUID>)?
    private var openJournals: [UUID: OpenJournal] = [:]

    init(
        rootURL: URL? = nil,
        fileManager: FileManager = .default,
        makeRevision: @escaping () -> String = { UUID().uuidString }
    ) {
        self.fileManager = fileManager
        self.makeRevision = makeRevision
        self.rootURL = rootURL ?? Self.defaultRootURL(fileManager: fileManager)
        encoder = JSONEncoder()
        decoder = JSONDecoder()
    }

    func finalize(record: DiveSessionRecord) throws -> DiveProfileManifestEntry {
        guard try !isSessionDeleted(record.id) else {
            throw CocoaError(.fileWriteFileExists)
        }
        let safeRecord = record.sanitizedForPersistence()
        let revision = safeRecord.profile?.contentRevision ?? makeRevision()
        let profile = DiveProfileMetadata(
            contentRevision: revision,
            sampleCount: safeRecord.samples.count,
            interrupted: safeRecord.profile?.interrupted
        )
        let profiledRecord = safeRecord.withProfile(profile)
        let artifactData = try canonicalSyncArtifactData(for: profiledRecord)
        let relativePath = artifactRelativePath(sessionID: profiledRecord.id, revision: revision)
        let finalURL = rootURL.appendingPathComponent(relativePath)

        try fileManager.createDirectory(
            at: finalURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try artifactData.write(to: finalURL, options: .atomic)

        let identity = DiveProfileArtifactIdentity(
            localSessionId: profiledRecord.id,
            contentRevision: revision,
            sha256: Self.sha256Hex(artifactData),
            byteCount: artifactData.count,
            sampleCount: profiledRecord.samples.count,
            relativePath: relativePath
        )
        // The identity was computed from these exact bytes, so reading them back proves the file.
        guard try Data(contentsOf: finalURL) == artifactData else {
            throw CocoaError(.fileReadCorruptFile)
        }

        let entry = DiveProfileManifestEntry(
            displayRecord: profiledRecord.withSamples(Self.makePreview(from: profiledRecord.samples)),
            artifact: identity
        )
        var entries = try loadEntries()
        if let index = entries.firstIndex(where: { $0.id == entry.id }) {
            entries[index] = entry
        } else {
            entries.append(entry)
        }
        try save(entries: entries)
        return entry
    }

    /// Decodes the manifest once and reuses it until the file changes on disk.
    func loadEntries() throws -> [DiveProfileManifestEntry] {
        guard fileManager.fileExists(atPath: manifestURL.path) else {
            cachedManifest = nil
            return []
        }
        let stamp = fileStamp(at: manifestURL)
        if let cachedManifest, cachedManifest.stamp == stamp {
            return cachedManifest.entries
        }
        let manifest = try decoder.decode(Manifest.self, from: Data(contentsOf: manifestURL))
        guard manifest.formatVersion == 1 else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let entries = Self.newestFirst(manifest.entries)
        cachedManifest = stamp.map { (stamp: $0, entries: entries) }
        return entries
    }

    func artifactURL(for identity: DiveProfileArtifactIdentity) -> URL {
        rootURL.appendingPathComponent(identity.relativePath)
    }

    func isSessionDeleted(_ localSessionId: UUID) throws -> Bool {
        try loadDeletedSessionIds().contains(localSessionId)
    }

    @discardableResult
    func deleteSession(
        localSessionId: UUID
    ) throws -> DeletedDiveSessionArtifact? {
        try recordDeletionIntent(localSessionId)

        let entries = try loadEntries()
        let removedEntry = entries.first { $0.id == localSessionId }
        let remainingEntries = entries.filter { $0.id != localSessionId }
        if removedEntry != nil {
            try save(entries: remainingEntries)
        }

        let sessionURL = sessionDirectory(for: localSessionId)
        closeJournal(for: localSessionId)
        if fileManager.fileExists(atPath: sessionURL.path) {
            try fileManager.removeItem(at: sessionURL)
        }

        guard try loadEntries().allSatisfy({ $0.id != localSessionId }),
              !fileManager.fileExists(atPath: sessionURL.path) else {
            throw CocoaError(.fileWriteUnknown)
        }
        return removedEntry.map {
            DeletedDiveSessionArtifact(
                localSessionId: localSessionId,
                contentRevision: $0.artifact.contentRevision,
                artifactSha256: $0.artifact.sha256
            )
        }
    }

    /// Finishes deletions an earlier run recorded but did not complete. Finished ones stay in the
    /// ledger as tombstones and are skipped without touching the manifest.
    func resumePendingDeletions() throws {
        let remainingIds = Set(try loadEntries().map(\.id))
        for localSessionId in try loadDeletedSessionIds()
        where remainingIds.contains(localSessionId)
            || fileManager.fileExists(atPath: sessionDirectory(for: localSessionId).path) {
            try deleteSession(localSessionId: localSessionId)
        }
    }

    func verifyArtifact(_ identity: DiveProfileArtifactIdentity) throws {
        _ = try verifiedArtifactData(for: identity)
    }

    func matchesCanonicalArtifact(
        for record: DiveSessionRecord,
        existing identity: DiveProfileArtifactIdentity,
        explicitProfile: DiveProfileMetadata? = nil
    ) throws -> Bool {
        guard record.id == identity.localSessionId else {
            return false
        }

        let artifactData = try verifiedArtifactData(for: identity)
        let expectedArtifact = try canonicalArtifact(
            for: record,
            matching: identity,
            artifactData: artifactData,
            explicitProfile: explicitProfile
        )
        return expectedArtifact.identity == identity && expectedArtifact.data == artifactData
    }

    func canonicalArtifact(
        for record: DiveSessionRecord,
        matching identity: DiveProfileArtifactIdentity
    ) throws -> CanonicalDiveProfileArtifact {
        guard record.id == identity.localSessionId else {
            throw CocoaError(.fileNoSuchFile)
        }

        let artifactData = try verifiedArtifactData(for: identity)
        return try canonicalArtifact(for: record, matching: identity, artifactData: artifactData)
    }

    private func canonicalArtifact(
        for record: DiveSessionRecord,
        matching identity: DiveProfileArtifactIdentity,
        artifactData: Data,
        explicitProfile: DiveProfileMetadata? = nil
    ) throws -> CanonicalDiveProfileArtifact {
        let existingProfile = try profileMetadata(from: artifactData)
        let suppliedProfile = explicitProfile ?? record.profile
        if let suppliedProfile, suppliedProfile != existingProfile {
            throw CocoaError(.fileWriteFileExists)
        }

        let canonicalProfile = suppliedProfile ?? existingProfile
        let canonicalRecord = record.sanitizedForPersistence().withProfile(canonicalProfile)
        let canonicalData = try canonicalSyncArtifactData(for: canonicalRecord)
        let expectedIdentity = DiveProfileArtifactIdentity(
            localSessionId: canonicalRecord.id,
            contentRevision: canonicalProfile.contentRevision,
            sha256: Self.sha256Hex(canonicalData),
            byteCount: canonicalData.count,
            sampleCount: canonicalRecord.samples.count,
            relativePath: artifactRelativePath(
                sessionID: canonicalRecord.id,
                revision: canonicalProfile.contentRevision
            )
        )

        return CanonicalDiveProfileArtifact(data: canonicalData, identity: expectedIdentity)
    }

    private func verifiedArtifactData(for identity: DiveProfileArtifactIdentity) throws -> Data {
        let data = try Data(contentsOf: artifactURL(for: identity))
        guard data.count == identity.byteCount,
              Self.sha256Hex(data) == identity.sha256,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let session = object["session"] as? [String: Any],
              session["localSessionId"] as? String == identity.localSessionId.uuidString,
              let profile = session["profile"] as? [String: Any],
              profile["contentRevision"] as? String == identity.contentRevision,
              profile["sampleCount"] as? Int == identity.sampleCount,
              let samples = session["samples"] as? [[String: Any]],
              samples.count == identity.sampleCount else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return data
    }

    private func profileMetadata(from artifactData: Data) throws -> DiveProfileMetadata {
        guard let object = try JSONSerialization.jsonObject(with: artifactData) as? [String: Any],
              let session = object["session"] as? [String: Any],
              let profile = session["profile"] else {
            throw CocoaError(.fileReadCorruptFile)
        }

        return try decoder.decode(
            DiveProfileMetadata.self,
            from: JSONSerialization.data(withJSONObject: profile)
        )
    }

    private func canonicalSyncArtifactData(for record: DiveSessionRecord) throws -> Data {
        let syncData = try record.syncMessageData()
        let object = try JSONSerialization.jsonObject(with: syncData)
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    func migrateLegacyRecords(at legacyURL: URL) throws -> [DiveProfileManifestEntry] {
        guard fileManager.fileExists(atPath: legacyURL.path) else {
            return try loadEntries()
        }

        let records = try decoder.decode([DiveSessionRecord].self, from: Data(contentsOf: legacyURL))
        var entries = try loadEntries()
        for record in records {
            if try isSessionDeleted(record.id) {
                continue
            }
            if let existing = entries.first(where: { $0.id == record.id }) {
                try verifyArtifact(existing.artifact)
                continue
            }
            let entry = try finalize(record: record)
            entries.removeAll { $0.id == entry.id }
            entries.append(entry)
        }

        for entry in entries where records.contains(where: { $0.id == entry.id }) {
            try verifyArtifact(entry.artifact)
        }
        try fileManager.removeItem(at: legacyURL)
        return try loadEntries()
    }

    func beginRecording(_ metadata: ActiveDiveRecordingMetadata) throws {
        guard try !isSessionDeleted(metadata.localSessionId) else {
            throw CocoaError(.fileWriteFileExists)
        }
        let directory = sessionDirectory(for: metadata.localSessionId)
        let metadataURL = activeMetadataURL(for: metadata.localSessionId)
        let journalURL = recordingJournalURL(for: metadata.localSessionId)

        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try encoder.encode(metadata).write(to: metadataURL, options: .atomic)
            guard fileManager.fileExists(atPath: metadataURL.path),
                  fileManager.createFile(atPath: journalURL.path, contents: nil),
                  fileManager.fileExists(atPath: journalURL.path)
            else {
                throw CocoaError(.fileWriteUnknown)
            }
            closeJournal(for: metadata.localSessionId)
            openJournals[metadata.localSessionId] = OpenJournal(
                handle: try FileHandle(forWritingTo: journalURL),
                durableLength: 0,
                lastSample: nil
            )
        } catch {
            let setupError = error
            try? clearActiveRecording(sessionID: metadata.localSessionId)
            throw setupError
        }
    }

    /// Appends one sample line to the session's journal. The journal stays open between samples.
    /// After a failed write the journal is re-read from disk on the next call, which drops a torn
    /// line and skips a retried sample whose line had already landed.
    func append(_ sample: DepthSample, to sessionID: UUID) throws {
        guard try !isSessionDeleted(sessionID), sample.isValidRecordingSample else {
            throw CocoaError(.fileNoSuchFile)
        }
        let journal = try openJournal(for: sessionID)
        if journal.lastSample == sample {
            return
        }

        let line = try journalLine(for: sample)
        do {
            try journal.handle.seek(toOffset: journal.durableLength)
            try journal.handle.write(contentsOf: line)
            journal.appendsSinceSync += 1
            if journal.appendsSinceSync >= Self.appendsPerSync {
                try journal.handle.synchronize()
                journal.appendsSinceSync = 0
            }
        } catch {
            closeJournal(for: sessionID)
            throw error
        }
        journal.durableLength += UInt64(line.count)
        journal.lastSample = sample
    }

    func loadActiveRecordings() throws -> [ActiveDiveRecording] {
        let sessionsURL = rootURL.appendingPathComponent("Sessions", isDirectory: true)
        guard fileManager.fileExists(atPath: sessionsURL.path) else {
            return []
        }

        let directories = try fileManager.contentsOfDirectory(
            at: sessionsURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        var recordings: [ActiveDiveRecording] = []
        for directory in directories {
            let metadataURL = directory.appendingPathComponent("active-recording.json")
            guard fileManager.fileExists(atPath: metadataURL.path) else {
                continue
            }

            do {
                let metadata = try decoder.decode(
                    ActiveDiveRecordingMetadata.self,
                    from: Data(contentsOf: metadataURL)
                )
                guard directory.lastPathComponent == metadata.localSessionId.uuidString else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                guard try !isSessionDeleted(metadata.localSessionId) else {
                    try fileManager.removeItem(at: directory)
                    continue
                }
                try discardLegacyPendingAppend(sessionID: metadata.localSessionId)
                let journalURL = directory.appendingPathComponent("recording.ndjson")
                let samples = try loadJournalSamples(at: journalURL)
                recordings.append(ActiveDiveRecording(metadata: metadata, samples: samples))
            } catch {
                if shouldQuarantineActiveRecording(for: error) {
                    try? quarantineActiveRecording(in: directory)
                }
            }
        }
        return recordings
    }

    func clearActiveRecording(sessionID: UUID) throws {
        closeJournal(for: sessionID)
        for url in [
            pendingAppendURL(for: sessionID),
            recordingJournalURL(for: sessionID),
            activeMetadataURL(for: sessionID),
        ]
        where fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    /// Records new sync statuses in one manifest write. Deleted sessions and unchanged
    /// statuses are skipped, so a repeated acknowledgement writes nothing.
    func updateSyncStatuses(_ statuses: [UUID: DiveSyncStatus]) throws {
        var entries = try loadEntries()
        var changed = false
        for index in entries.indices {
            let sessionID = entries[index].id
            guard let status = statuses[sessionID],
                  entries[index].displayRecord.syncStatus != status,
                  try !isSessionDeleted(sessionID) else {
                continue
            }
            entries[index].displayRecord = entries[index].displayRecord.withSyncStatus(status)
            changed = true
        }
        if changed {
            try save(entries: entries)
        }
    }

    private var manifestURL: URL {
        rootURL.appendingPathComponent("session-manifest.json")
    }

    private var deletionLedgerURL: URL {
        rootURL.appendingPathComponent("deleted-session-ledger.json")
    }

    private func recordDeletionIntent(_ localSessionId: UUID) throws {
        var sessionIds = try loadDeletedSessionIds()
        guard sessionIds.insert(localSessionId).inserted else {
            return
        }
        try saveDeletedSessionIds(sessionIds)
    }

    /// Every recorded sample checks the ledger, so it is decoded once and reused until it changes.
    private func loadDeletedSessionIds() throws -> Set<UUID> {
        guard fileManager.fileExists(atPath: deletionLedgerURL.path) else {
            cachedDeletedSessionIds = nil
            return []
        }
        let stamp = fileStamp(at: deletionLedgerURL)
        if let cachedDeletedSessionIds, cachedDeletedSessionIds.stamp == stamp {
            return cachedDeletedSessionIds.sessionIds
        }
        let ledger = try decoder.decode(
            DeletedSessionLedger.self,
            from: Data(contentsOf: deletionLedgerURL)
        )
        guard ledger.formatVersion == 1,
              Set(ledger.sessionIds).count == ledger.sessionIds.count else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let sessionIds = Set(ledger.sessionIds)
        cachedDeletedSessionIds = stamp.map { (stamp: $0, sessionIds: sessionIds) }
        return sessionIds
    }

    private func saveDeletedSessionIds(_ sessionIds: Set<UUID>) throws {
        try fileManager.createDirectory(
            at: rootURL,
            withIntermediateDirectories: true
        )
        let ledger = DeletedSessionLedger(
            formatVersion: 1,
            sessionIds: sessionIds.sorted {
                $0.uuidString < $1.uuidString
            }
        )
        try encoder.encode(ledger).write(to: deletionLedgerURL, options: .atomic)
        guard try loadDeletedSessionIds() == sessionIds else {
            throw CocoaError(.fileWriteUnknown)
        }
    }

    private func save(entries: [DiveProfileManifestEntry]) throws {
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        let manifest = Manifest(formatVersion: 1, entries: entries)
        cachedManifest = nil
        try encoder.encode(manifest).write(to: manifestURL, options: .atomic)
        cachedManifest = fileStamp(at: manifestURL).map {
            (stamp: $0, entries: Self.newestFirst(entries))
        }
    }

    private func fileStamp(at url: URL) -> FileStamp? {
        guard let attributes = try? fileManager.attributesOfItem(atPath: url.path),
              let modificationDate = attributes[.modificationDate] as? Date,
              let byteCount = (attributes[.size] as? NSNumber)?.intValue else {
            return nil
        }
        return FileStamp(modificationDate: modificationDate, byteCount: byteCount)
    }

    private static func newestFirst(_ entries: [DiveProfileManifestEntry]) -> [DiveProfileManifestEntry] {
        entries.sorted { $0.displayRecord.startedAt > $1.displayRecord.startedAt }
    }

    private func sessionDirectory(for sessionID: UUID) -> URL {
        rootURL
            .appendingPathComponent("Sessions", isDirectory: true)
            .appendingPathComponent(sessionID.uuidString, isDirectory: true)
    }

    private func activeMetadataURL(for sessionID: UUID) -> URL {
        sessionDirectory(for: sessionID).appendingPathComponent("active-recording.json")
    }

    private func recordingJournalURL(for sessionID: UUID) -> URL {
        sessionDirectory(for: sessionID).appendingPathComponent("recording.ndjson")
    }

    private func pendingAppendURL(for sessionID: UUID) -> URL {
        sessionDirectory(for: sessionID).appendingPathComponent("recording-pending.json")
    }

    private func journalLine(for sample: DepthSample) throws -> Data {
        var line = try encoder.encode(sample)
        line.append(0x0A)
        return line
    }

    /// Returns the open journal of an active recording, re-reading it from disk when this store
    /// has not opened it yet or a write failed.
    private func openJournal(for sessionID: UUID) throws -> OpenJournal {
        if let journal = openJournals[sessionID] {
            return journal
        }
        let journalURL = recordingJournalURL(for: sessionID)
        guard fileManager.fileExists(atPath: activeMetadataURL(for: sessionID).path),
              fileManager.fileExists(atPath: journalURL.path) else {
            throw CocoaError(.fileNoSuchFile)
        }
        try discardLegacyPendingAppend(sessionID: sessionID)
        let durableSamples = try loadJournalSamples(at: journalURL)
        let handle = try FileHandle(forWritingTo: journalURL)
        let journal = OpenJournal(
            handle: handle,
            durableLength: try handle.seekToEnd(),
            lastSample: durableSamples.last
        )
        openJournals[sessionID] = journal
        return journal
    }

    private func closeJournal(for sessionID: UUID) {
        guard let journal = openJournals.removeValue(forKey: sessionID) else {
            return
        }
        try? journal.handle.synchronize()
        try? journal.handle.close()
    }

    /// Older builds staged each sample in a sidecar before appending it. Reading the journal
    /// already repairs a torn final line, so a leftover sidecar is only removed.
    private func discardLegacyPendingAppend(sessionID: UUID) throws {
        let pendingURL = pendingAppendURL(for: sessionID)
        if fileManager.fileExists(atPath: pendingURL.path) {
            try fileManager.removeItem(at: pendingURL)
        }
    }

    private func loadJournalSamples(at journalURL: URL) throws -> [DepthSample] {
        let journalData = try Data(contentsOf: journalURL)
        guard !journalData.isEmpty else {
            return []
        }

        var records = journalData.split(separator: 0x0A, omittingEmptySubsequences: false)
        let hasTerminatingNewline = journalData.last == 0x0A
        if hasTerminatingNewline {
            records.removeLast()
        }

        let completeRecords = hasTerminatingNewline ? records[...] : records.dropLast()
        var samples = try completeRecords.map { record -> DepthSample in
            let sample = try decoder.decode(DepthSample.self, from: Data(record))
            guard sample.isValidRecordingSample else {
                throw CocoaError(.fileReadCorruptFile)
            }
            return sample
        }

        guard !hasTerminatingNewline, let trailingRecord = records.last else {
            return samples
        }

        if let sample = try? decoder.decode(DepthSample.self, from: Data(trailingRecord)),
           sample.isValidRecordingSample {
            let handle = try FileHandle(forWritingTo: journalURL)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data([0x0A]))
            try handle.synchronize()
            samples.append(sample)
            return samples
        }

        let durablePrefixLength = UInt64(journalData.count - trailingRecord.count)
        let handle = try FileHandle(forWritingTo: journalURL)
        defer { try? handle.close() }
        try handle.truncate(atOffset: durablePrefixLength)
        try handle.synchronize()
        return samples
    }

    private func shouldQuarantineActiveRecording(for error: Error) -> Bool {
        if error is DecodingError {
            return true
        }
        guard let cocoaError = error as? CocoaError else {
            return false
        }
        return cocoaError.code == .fileReadCorruptFile || cocoaError.code == .fileNoSuchFile
    }

    private func quarantineActiveRecording(in sessionURL: URL) throws {
        let activeURLs = [
            sessionURL.appendingPathComponent("active-recording.json"),
            sessionURL.appendingPathComponent("recording.ndjson"),
            sessionURL.appendingPathComponent("recording-pending.json"),
        ].filter { fileManager.fileExists(atPath: $0.path) }
        guard !activeURLs.isEmpty else {
            return
        }

        let quarantineURL = sessionURL
            .appendingPathComponent("Quarantine", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: quarantineURL, withIntermediateDirectories: true)
        for activeURL in activeURLs {
            try fileManager.moveItem(
                at: activeURL,
                to: quarantineURL.appendingPathComponent(activeURL.lastPathComponent)
            )
        }
    }

    private func artifactRelativePath(sessionID: UUID, revision: String) -> String {
        let safeRevision = revision.map { character in
            character.isLetter || character.isNumber || character == "-" || character == "_" ? character : "_"
        }
        return "Sessions/\(sessionID.uuidString)/session-\(String(safeRevision)).json"
    }

    private static func makePreview(from samples: [DepthSample], limit: Int = 160) -> [DepthSample] {
        guard samples.count > limit, limit > 1 else {
            return samples
        }
        let scale = Double(samples.count - 1) / Double(limit - 1)
        return (0..<limit).map { index in
            samples[Int((Double(index) * scale).rounded())]
        }
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func defaultRootURL(fileManager: FileManager) -> URL {
        let baseURL = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        return baseURL.appendingPathComponent("DivenaryWatchApp", isDirectory: true)
    }
}
