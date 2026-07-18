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

    private let rootURL: URL
    private let fileManager: FileManager
    private let makeRevision: () -> String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

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
        try verifyArtifact(identity)

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

    func loadEntries() throws -> [DiveProfileManifestEntry] {
        guard fileManager.fileExists(atPath: manifestURL.path) else {
            return []
        }
        let manifest = try decoder.decode(Manifest.self, from: Data(contentsOf: manifestURL))
        guard manifest.formatVersion == 1 else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return manifest.entries.sorted { $0.displayRecord.startedAt > $1.displayRecord.startedAt }
    }

    func artifactURL(for identity: DiveProfileArtifactIdentity) -> URL {
        rootURL.appendingPathComponent(identity.relativePath)
    }

    func verifyArtifact(_ identity: DiveProfileArtifactIdentity) throws {
        _ = try verifiedArtifactData(for: identity)
    }

    func matchesCanonicalArtifact(
        for record: DiveSessionRecord,
        existing identity: DiveProfileArtifactIdentity
    ) throws -> Bool {
        guard record.id == identity.localSessionId else {
            return false
        }

        let artifactData = try verifiedArtifactData(for: identity)
        let expectedArtifact = try canonicalArtifact(for: record, matching: identity, artifactData: artifactData)
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
        artifactData: Data
    ) throws -> CanonicalDiveProfileArtifact {
        let existingProfile = try profileMetadata(from: artifactData)
        let canonicalProfile = DiveProfileMetadata(
            formatVersion: existingProfile.formatVersion,
            contentRevision: identity.contentRevision,
            sampleIntervalSeconds: existingProfile.sampleIntervalSeconds,
            sampleCount: existingProfile.sampleCount,
            interrupted: existingProfile.interrupted
        )
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
        let directory = sessionDirectory(for: metadata.localSessionId)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try encoder.encode(metadata).write(to: activeMetadataURL(for: metadata.localSessionId), options: .atomic)
        let journalURL = recordingJournalURL(for: metadata.localSessionId)
        if !fileManager.fileExists(atPath: journalURL.path) {
            _ = fileManager.createFile(atPath: journalURL.path, contents: nil)
        }
    }

    func append(_ sample: DepthSample, to sessionID: UUID) throws {
        guard sample.isValidRecordingSample,
              fileManager.fileExists(atPath: activeMetadataURL(for: sessionID).path) else {
            throw CocoaError(.fileNoSuchFile)
        }

        let handle = try FileHandle(forWritingTo: recordingJournalURL(for: sessionID))
        defer { try? handle.close() }
        try handle.seekToEnd()
        var line = try encoder.encode(sample)
        line.append(0x0A)
        try handle.write(contentsOf: line)
        try handle.synchronize()
    }

    func loadActiveRecordings() throws -> [ActiveDiveRecording] {
        let sessionsURL = rootURL.appendingPathComponent("Sessions", isDirectory: true)
        guard fileManager.fileExists(atPath: sessionsURL.path) else {
            return []
        }

        return try fileManager.contentsOfDirectory(
            at: sessionsURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).compactMap { directory in
            let metadataURL = directory.appendingPathComponent("active-recording.json")
            guard fileManager.fileExists(atPath: metadataURL.path) else {
                return nil
            }
            let metadata = try decoder.decode(
                ActiveDiveRecordingMetadata.self,
                from: Data(contentsOf: metadataURL)
            )
            let journalURL = directory.appendingPathComponent("recording.ndjson")
            let journalData = try Data(contentsOf: journalURL)
            let samples = try journalData
                .split(separator: 0x0A)
                .map { try decoder.decode(DepthSample.self, from: Data($0)) }
            return ActiveDiveRecording(metadata: metadata, samples: samples)
        }
    }

    func clearActiveRecording(sessionID: UUID) throws {
        for url in [activeMetadataURL(for: sessionID), recordingJournalURL(for: sessionID)]
        where fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    func updateDisplayRecord(_ displayRecord: DiveSessionRecord) throws {
        var entries = try loadEntries()
        guard let index = entries.firstIndex(where: { $0.id == displayRecord.id }) else {
            throw CocoaError(.fileNoSuchFile)
        }
        let existing = entries[index].displayRecord
        var updated = displayRecord.withSamples(existing.samples)
        if let profile = existing.profile {
            updated = updated.withProfile(profile)
        }
        entries[index].displayRecord = updated.sanitizedForPersistence()
        try save(entries: entries)
    }

    private var manifestURL: URL {
        rootURL.appendingPathComponent("session-manifest.json")
    }

    private func save(entries: [DiveProfileManifestEntry]) throws {
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        let manifest = Manifest(formatVersion: 1, entries: entries)
        try encoder.encode(manifest).write(to: manifestURL, options: .atomic)
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
