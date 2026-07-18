import Combine
import Foundation

@MainActor
final class DiveSessionRecorder: ObservableObject, DiveSessionRecording {
    @Published private(set) var samples: [DepthSample] = []
    @Published private(set) var currentDepth: Double = 0
    @Published private(set) var maxDepth: Double = 0
    @Published private(set) var waterTemperatureCelsius: Double?
    @Published private(set) var elapsedTime: TimeInterval = 0
    var hasCapturedDepthSample: Bool { lastRawSample != nil }
    @Published private(set) var latestAscentRateMetersPerMinute: Double = 0
    @Published private(set) var safetyStopRemainingSeconds: TimeInterval = 180
    @Published private(set) var safetyStopActive = false
    @Published private(set) var ascentWarningActive = false
    @Published private(set) var currentRecordPayload: DiveSessionPayload?
    @Published private(set) var freeSnapshot: FreeDiveSessionSnapshot?
    @Published private(set) var scubaSafetyStop: SafetyStopRecord = .legacyUnknown
    @Published private(set) var isRecording = false
    @Published private(set) var recordingPersistenceError: String?

    private let sensorProvider: DepthSensorProvider
    private let captureMode: DiveCaptureMode
    private let profileStore: DiveProfileRecordingStoring
    private let now: () -> Date
    private var startedAt: Date?
    private var activeRecordID: UUID?
    private var activePlan = PreDivePlan()
    private var freeEngine: FreeDiveSessionEngine?
    private var scubaEngine: ScubaDiveEngine?
    private var profileSampler: OneHertzProfileSampler?
    private var lastRawSample: DepthSample?
    private var displayAscentRateEstimator = DisplayAscentRateEstimator()
    private var elapsedTimer: Timer?
    private let recommendedAscentRateMetersPerMinute: Double = 9

    init(
        sensorProvider: DepthSensorProvider,
        captureMode: DiveCaptureMode = .real,
        profileStore: DiveProfileRecordingStoring = DiveProfileArtifactStore(),
        now: @escaping () -> Date = Date.init
    ) {
        self.sensorProvider = sensorProvider
        self.captureMode = captureMode
        self.profileStore = profileStore
        self.now = now
    }

    @discardableResult
    func startSession(plan: PreDivePlan = PreDivePlan()) -> Bool {
        guard !isRecording, activeRecordID == nil else { return false }

        samples = []
        currentDepth = 0
        maxDepth = 0
        waterTemperatureCelsius = nil
        elapsedTime = 0
        latestAscentRateMetersPerMinute = 0
        safetyStopRemainingSeconds = 180
        safetyStopActive = false
        ascentWarningActive = false
        currentRecordPayload = nil
        freeSnapshot = nil
        scubaSafetyStop = .legacyUnknown
        recordingPersistenceError = nil
        displayAscentRateEstimator.reset()
        let startedAt = now()
        let sessionID = UUID()
        lastRawSample = nil
        do {
            try profileStore.beginRecording(ActiveDiveRecordingMetadata(
                localSessionId: sessionID,
                startedAt: startedAt,
                captureMode: captureMode,
                plan: plan
            ))
        } catch {
            recordingPersistenceError = error.localizedDescription
            return false
        }

        self.startedAt = startedAt
        activeRecordID = sessionID
        activePlan = plan
        profileSampler = OneHertzProfileSampler(startedAt: startedAt)
        switch plan.diveMode {
        case .freedive:
            freeEngine = FreeDiveSessionEngine(startedAt: startedAt)
            scubaEngine = nil
        case .scuba:
            scubaEngine = ScubaDiveEngine(startedAt: startedAt, gasLabel: plan.gasLabel, sessionID: sessionID)
            freeEngine = nil
        }
        isRecording = true

        sensorProvider.onSample = { [weak self] sample in
            self?.append(sample)
        }
        sensorProvider.start()

        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateElapsedTime()
            }
        }
        return true
    }

    func stopSession() -> DiveSessionRecord? {
        guard isRecording, let startedAt, let recordID = activeRecordID else { return nil }

        sensorProvider.stop()
        sensorProvider.onSample = nil
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        flushFinalProfileSample()
        updateElapsedTime()
        isRecording = false
        let endedAt = max(now(), lastRawSample?.timestamp ?? startedAt)
        let sourcePlanLocalId = activePlan.sourcePlanLocalId
        var sessionTags = activePlan.tags
        if let sourcePlanLocalId, !sessionTags.contains("plan-\(sourcePlanLocalId)") {
            sessionTags.append("plan-\(sourcePlanLocalId)")
        }

        let payload: DiveSessionPayload
        switch activePlan.diveMode {
        case .freedive:
            guard var engine = freeEngine else { return nil }
            let session = normalizeFreediveSession(engine.finish(at: endedAt), samples: samples)
            payload = .freedive(
                FreeDiveSession(
                    id: recordID,
                    startTime: session.startTime,
                    endTime: session.endTime,
                    totalDurationSeconds: session.totalDurationSeconds,
                    maxDepthMeters: session.maxDepthMeters,
                    diveCount: session.diveCount,
                    longestDiveDurationSeconds: session.longestDiveDurationSeconds,
                    segments: session.segments
                )
            )
        case .scuba:
            guard var engine = scubaEngine else { return nil }
            payload = .scuba(normalizeScubaSession(engine.finish(at: endedAt), samples: samples))
        }
        currentRecordPayload = payload

        return DiveSessionRecord(
            id: recordID,
            schemaVersion: 3,
            captureMode: captureMode,
            diveMode: activePlan.diveMode,
            siteId: nil,
            siteName: activePlan.siteName.isEmpty ? nil : activePlan.siteName,
            sourcePlanLocalId: activePlan.sourcePlanLocalId,
            planTitle: activePlan.title.isEmpty ? nil : activePlan.title,
            buddyIds: activePlan.buddyIds,
            gearIds: activePlan.gearIds,
            tags: sessionTags,
            notes: activePlan.quickNote.isEmpty ? nil : activePlan.quickNote,
            rating: nil,
            perceivedExertion: nil,
            visibilityRating: nil,
            waterCondition: .unknown,
            syncStatus: .pending,
            entryLocation: nil,
            exitLocation: nil,
            startedAt: startedAt,
            endedAt: endedAt,
            samples: samples,
            payload: payload
        )
    }

    @discardableResult
    func cancelSession() -> Bool {
        stopCaptureAndResetSessionState()
        guard let sessionID = activeRecordID else {
            return true
        }

        do {
            try profileStore.clearActiveRecording(sessionID: sessionID)
            activeRecordID = nil
            return true
        } catch {
            recordingPersistenceError = error.localizedDescription
            return false
        }
    }

    func resetCompletedSession() {
        stopCaptureAndResetSessionState()
        activeRecordID = nil
    }

    private func stopCaptureAndResetSessionState() {
        sensorProvider.stop()
        sensorProvider.onSample = nil
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        displayAscentRateEstimator.reset()
        latestAscentRateMetersPerMinute = 0
        ascentWarningActive = false
        currentRecordPayload = nil
        freeSnapshot = nil
        scubaSafetyStop = .legacyUnknown
        freeEngine = nil
        scubaEngine = nil
        profileSampler = nil
        lastRawSample = nil
        startedAt = nil
        isRecording = false
    }

    func setDemoDepthMeters(_ depthMeters: Double) {
        (sensorProvider as? DemoDepthSensorProvider)?.setDepthMeters(depthMeters)
    }

    private func append(_ sample: DepthSample) {
        guard isRecording, sample.isValidRecordingSample else {
            return
        }

        lastRawSample = sample
        currentDepth = sample.depthMeters
        maxDepth = max(maxDepth, sample.depthMeters)
        if let measuredTemperature = sample.waterTemperatureCelsius {
            waterTemperatureCelsius = measuredTemperature
        }
        latestAscentRateMetersPerMinute = displayAscentRateEstimator.append(sample)
        ascentWarningActive = latestAscentRateMetersPerMinute > recommendedAscentRateMetersPerMinute

        if let finalized = profileSampler?.append(sample) {
            persistProfileSample(finalized)
        }

        switch activePlan.diveMode {
        case .freedive:
            freeEngine?.append(sample)
            freeSnapshot = freeEngine?.snapshot
            maxDepth = max(maxDepth, sample.depthMeters, freeSnapshot?.maxDepthMeters ?? 0)
            scubaSafetyStop = .legacyUnknown
            safetyStopRemainingSeconds = SafetyStopRecord.legacyUnknown.remainingSeconds
            safetyStopActive = false
        case .scuba:
            scubaEngine?.append(sample)
            scubaSafetyStop = scubaEngine?.safetyStopRecord ?? .legacyUnknown
            maxDepth = max(maxDepth, sample.depthMeters)
            safetyStopRemainingSeconds = scubaSafetyStop.remainingSeconds
            safetyStopActive = scubaSafetyStop.status == .active
        }
    }

    private func updateElapsedTime() {
        guard let startedAt else {
            elapsedTime = 0
            return
        }

        elapsedTime = max(0, now().timeIntervalSince(startedAt))
    }

    private func flushFinalProfileSample() {
        guard let finalized = profileSampler?.finish() else { return }
        persistProfileSample(finalized)
    }

    private func persistProfileSample(_ sample: DepthSample) {
        samples.append(sample)
        guard let activeRecordID else { return }
        do {
            try profileStore.append(sample, to: activeRecordID)
            recordingPersistenceError = nil
        } catch {
            recordingPersistenceError = error.localizedDescription
        }
    }

    private func normalizeFreediveSession(
        _ session: FreeDiveSession,
        samples: [DepthSample]
    ) -> FreeDiveSession {
        let segments = session.segments.map { segment in
            let segmentEndTime = segment.endTime
                ?? session.endTime
                ?? samples.last?.timestamp
                ?? segment.startTime
            let matchingIndices = samples.indices.filter {
                samples[$0].timestamp >= segment.startTime && samples[$0].timestamp <= segmentEndTime
            }
            return FreeDiveSegment(
                id: segment.id,
                index: segment.index,
                startTime: segment.startTime,
                endTime: segment.endTime,
                durationSeconds: segment.durationSeconds,
                maxDepthMeters: segment.maxDepthMeters,
                minDepthMeters: segment.minDepthMeters,
                sampleStartIndex: matchingIndices.first ?? 0,
                sampleEndIndex: matchingIndices.last ?? 0,
                descentRateMetersPerSecond: segment.descentRateMetersPerSecond,
                ascentRateMetersPerSecond: segment.ascentRateMetersPerSecond
            )
        }
        return FreeDiveSession(
            id: session.id,
            startTime: session.startTime,
            endTime: session.endTime,
            totalDurationSeconds: session.totalDurationSeconds,
            maxDepthMeters: session.maxDepthMeters,
            diveCount: session.diveCount,
            longestDiveDurationSeconds: session.longestDiveDurationSeconds,
            segments: segments
        )
    }

    private func normalizeScubaSession(
        _ session: ScubaDiveSession,
        samples: [DepthSample]
    ) -> ScubaDiveSession {
        let averageDepth = samples.isEmpty
            ? 0
            : samples.reduce(0) { $0 + $1.depthMeters } / Double(samples.count)
        let temperatures = samples.compactMap(\.waterTemperatureCelsius)
        let averageTemperature = temperatures.isEmpty
            ? nil
            : temperatures.reduce(0, +) / Double(temperatures.count)
        let profileMax = samples.map { max($0.depthMeters, $0.bucketMaxDepthMeters ?? $0.depthMeters) }.max() ?? 0
        return ScubaDiveSession(
            id: session.id,
            startTime: session.startTime,
            endTime: session.endTime,
            durationSeconds: session.durationSeconds,
            maxDepthMeters: max(session.maxDepthMeters, profileMax),
            averageDepthMeters: averageDepth,
            waterTemperatureCelsius: averageTemperature,
            gasLabel: session.gasLabel,
            latestAscentRateMetersPerMinute: session.latestAscentRateMetersPerMinute,
            maxAscentRateMetersPerMinute: session.maxAscentRateMetersPerMinute,
            safetyStop: session.safetyStop
        )
    }
}
