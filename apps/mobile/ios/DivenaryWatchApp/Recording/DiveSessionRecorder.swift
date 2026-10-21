import Combine
import Foundation

/// Whether the live screen may show the latest depth as a current measurement.
enum LiveDepthSignal: Equatable {
    case awaitingFirstSample
    case live
    case stale
    case sensorError
    case beyondSensorRange
}

@MainActor
final class DiveSessionRecorder: ObservableObject, DiveSessionRecording {
    /// The 1 Hz profile of the current session. No view shows it, so it is not published.
    private(set) var samples: [DepthSample] = []
    @Published private(set) var currentDepth: Double = 0
    @Published private(set) var maxDepth: Double = 0
    @Published private(set) var waterTemperatureCelsius: Double?
    @Published private(set) var elapsedTime: TimeInterval = 0
    var hasCapturedDepthSample: Bool { lastRawSample != nil }
    @Published private(set) var latestAscentRateMetersPerMinute: Double = 0
    @Published private(set) var safetyStopRemainingSeconds: TimeInterval = 180
    @Published private(set) var safetyStopActive = false
    @Published private(set) var ascentWarningActive = false
    private(set) var currentRecordPayload: DiveSessionPayload?
    @Published private(set) var freeSnapshot: FreeDiveSessionSnapshot?
    @Published private(set) var scubaSafetyStop: SafetyStopRecord = .legacyUnknown
    @Published private(set) var isRecording = false
    @Published private(set) var recordingPersistenceError: String?
    @Published private(set) var liveDepthSignal: LiveDepthSignal = .awaitingFirstSample

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
    private var unconfirmedProfileSamples: ArraySlice<DepthSample> = []
    private var lastRawSample: DepthSample?
    private var displayAscentRateEstimator = DisplayAscentRateEstimator()
    private var elapsedTimer: Timer?
    private let recommendedAscentRateMetersPerMinute: Double = 9
    private var sensorCondition: DepthSensorCondition?
    private var sensorRangeExceededAt: Date?
    private var sensorRangeLimitMeters: Double?
    private var longestSampleGapSeconds: TimeInterval = 0
    private static let staleSampleSeconds: TimeInterval = 5
    private static let unreliableSampleGapSeconds: TimeInterval = 30

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
        unconfirmedProfileSamples = []
        resetSensorCoverage()
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
        (sensorProvider as? DepthSensorConditionReporting)?.onCondition = { [weak self] condition in
            self?.receive(condition)
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
        (sensorProvider as? DepthSensorConditionReporting)?.onCondition = nil
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
            payload = .scuba(normalizeScubaSession(
                engine.finish(at: endedAt),
                samples: samples,
                depthCoverageIsUnreliable: depthCoverageIsUnreliable
            ))
        }
        currentRecordPayload = payload
        let sensorRangeUnsupportedDepth = sensorRangeExceededAt.map { firstExceededAt in
            UnsupportedDepthRecord(
                exceeded: true,
                limitMeters: sensorRangeLimitMeters ?? DiveDepthSupport.supportedWatchDepthLimitMeters,
                maxDepthMeters: maxDepth,
                firstExceededAt: firstExceededAt
            )
        }

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
            payload: payload,
            unsupportedDepth: sensorRangeUnsupportedDepth
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
        (sensorProvider as? DepthSensorConditionReporting)?.onCondition = nil
        resetSensorCoverage()
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
        unconfirmedProfileSamples = []
        lastRawSample = nil
        startedAt = nil
        isRecording = false
    }

    func setDemoDepthMeters(_ depthMeters: Double) {
        (sensorProvider as? DemoDepthSensorProvider)?.setDepthMeters(depthMeters)
    }

    func refreshLiveDepthSignal() {
        let nextSignal: LiveDepthSignal
        switch sensorCondition {
        case .sensorError:
            nextSignal = .sensorError
        case .beyondSensorRange:
            nextSignal = .beyondSensorRange
        case .normal, nil:
            if let lastRawSample {
                let sampleAge = now().timeIntervalSince(lastRawSample.timestamp)
                nextSignal = sampleAge > Self.staleSampleSeconds ? .stale : .live
            } else {
                nextSignal = .awaitingFirstSample
            }
        }
        if liveDepthSignal != nextSignal {
            liveDepthSignal = nextSignal
        }
    }

    private var depthCoverageIsUnreliable: Bool {
        sensorRangeExceededAt != nil || longestSampleGapSeconds > Self.unreliableSampleGapSeconds
    }

    private func resetSensorCoverage() {
        sensorCondition = nil
        sensorRangeExceededAt = nil
        sensorRangeLimitMeters = nil
        longestSampleGapSeconds = 0
        liveDepthSignal = .awaitingFirstSample
    }

    private func receive(_ condition: DepthSensorCondition) {
        guard isRecording else {
            return
        }

        sensorCondition = condition
        if case let .beyondSensorRange(limitMeters, timestamp) = condition {
            sensorRangeExceededAt = sensorRangeExceededAt ?? timestamp
            sensorRangeLimitMeters = limitMeters ?? sensorRangeLimitMeters
        }
        refreshLiveDepthSignal()
    }

    private func append(_ sample: DepthSample) {
        guard isRecording, sample.isValidRecordingSample else {
            return
        }

        if let previousSample = lastRawSample {
            longestSampleGapSeconds = max(
                longestSampleGapSeconds,
                sample.timestamp.timeIntervalSince(previousSample.timestamp)
            )
        }
        lastRawSample = sample
        // Each published change re-renders the recording screen, so only changed values are set.
        publish(\.currentDepth, sample.depthMeters)
        if let measuredTemperature = sample.waterTemperatureCelsius {
            publish(\.waterTemperatureCelsius, measuredTemperature)
        }
        let ascentRate = displayAscentRateEstimator.append(sample)
        publish(\.latestAscentRateMetersPerMinute, ascentRate)
        publish(\.ascentWarningActive, ascentRate > recommendedAscentRateMetersPerMinute)

        if let finalized = profileSampler?.append(sample) {
            persistProfileSample(finalized)
        }

        switch activePlan.diveMode {
        case .freedive:
            freeEngine?.append(sample)
            let snapshot = freeEngine?.snapshot
            publish(\.freeSnapshot, snapshot)
            publish(\.maxDepth, max(maxDepth, sample.depthMeters, snapshot?.maxDepthMeters ?? 0))
            publish(\.scubaSafetyStop, .legacyUnknown)
            publish(\.safetyStopRemainingSeconds, SafetyStopRecord.legacyUnknown.remainingSeconds)
            publish(\.safetyStopActive, false)
        case .scuba:
            scubaEngine?.append(sample)
            let safetyStop = scubaEngine?.safetyStopRecord ?? .legacyUnknown
            publish(\.scubaSafetyStop, safetyStop)
            publish(\.maxDepth, max(maxDepth, sample.depthMeters))
            publish(\.safetyStopRemainingSeconds, safetyStop.remainingSeconds)
            publish(\.safetyStopActive, safetyStop.status == .active)
        }
        refreshLiveDepthSignal()
    }

    private func publish<Value: Equatable>(
        _ keyPath: ReferenceWritableKeyPath<DiveSessionRecorder, Value>,
        _ value: Value
    ) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }

    private func updateElapsedTime() {
        guard let startedAt else {
            elapsedTime = 0
            return
        }

        elapsedTime = max(0, now().timeIntervalSince(startedAt))
        refreshLiveDepthSignal()
    }

    private func flushFinalProfileSample() {
        if let finalized = profileSampler?.finish() {
            persistProfileSample(finalized)
        } else {
            persistUnconfirmedProfileSamples()
        }
    }

    private func persistProfileSample(_ sample: DepthSample) {
        samples.append(sample)
        unconfirmedProfileSamples.append(sample)
        persistUnconfirmedProfileSamples()
    }

    private func persistUnconfirmedProfileSamples() {
        guard let activeRecordID else { return }

        while let sample = unconfirmedProfileSamples.first {
            do {
                try profileStore.append(sample, to: activeRecordID)
                _ = unconfirmedProfileSamples.popFirst()
            } catch {
                recordingPersistenceError = error.localizedDescription
                return
            }
        }

        unconfirmedProfileSamples = []
        publish(\.recordingPersistenceError, nil)
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
        samples: [DepthSample],
        depthCoverageIsUnreliable: Bool
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
            safetyStop: depthCoverageIsUnreliable ? unknownSafetyStop(from: session.safetyStop) : session.safetyStop
        )
    }

    /// Missing depth coverage means the reminder state cannot be known, so never claim
    /// "not required" or "completed" from partial data.
    private func unknownSafetyStop(from record: SafetyStopRecord) -> SafetyStopRecord {
        SafetyStopRecord(
            status: .unknown,
            required: record.required,
            recommendationType: record.recommendationType,
            completed: false,
            targetDepthMeters: record.targetDepthMeters,
            minDepthMeters: record.minDepthMeters,
            maxDepthMeters: record.maxDepthMeters,
            durationSeconds: record.durationSeconds,
            startedAt: record.startedAt,
            completedAt: nil,
            remainingSeconds: record.remainingSeconds,
            timeInZoneSeconds: record.timeInZoneSeconds
        )
    }
}
