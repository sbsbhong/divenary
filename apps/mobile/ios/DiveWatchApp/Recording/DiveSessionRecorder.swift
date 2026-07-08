import Combine
import Foundation

@MainActor
final class DiveSessionRecorder: ObservableObject {
    @Published private(set) var samples: [DepthSample] = []
    @Published private(set) var currentDepth: Double = 0
    @Published private(set) var maxDepth: Double = 0
    @Published private(set) var waterTemperatureCelsius: Double?
    @Published private(set) var elapsedTime: TimeInterval = 0
    @Published private(set) var latestAscentRateMetersPerMinute: Double = 0
    @Published private(set) var safetyStopRemainingSeconds: TimeInterval = 180
    @Published private(set) var safetyStopActive = false
    @Published private(set) var ascentWarningActive = false
    @Published private(set) var currentRecordPayload: DiveSessionPayload?
    @Published private(set) var freeSnapshot: FreeDiveSessionSnapshot?
    @Published private(set) var scubaSafetyStop: SafetyStopRecord = .legacyUnknown
    @Published private(set) var isRecording = false

    private let sensorProvider: DepthSensorProvider
    private let captureMode: DiveCaptureMode
    private var startedAt: Date?
    private var activeRecordID: UUID?
    private var activePlan = PreDivePlan()
    private var freeEngine: FreeDiveSessionEngine?
    private var scubaEngine: ScubaDiveEngine?
    private var elapsedTimer: Timer?
    private let recommendedAscentRateMetersPerMinute: Double = 9

    init(sensorProvider: DepthSensorProvider, captureMode: DiveCaptureMode = .real) {
        self.sensorProvider = sensorProvider
        self.captureMode = captureMode
    }

    func startSession(plan: PreDivePlan = PreDivePlan()) {
        guard !isRecording else { return }

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
        activePlan = plan
        let startedAt = Date()
        let sessionID = UUID()
        self.startedAt = startedAt
        activeRecordID = sessionID
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
            Task { @MainActor in
                self?.append(sample)
            }
        }
        sensorProvider.start()

        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateElapsedTime()
            }
        }
    }

    func stopSession() -> DiveSessionRecord? {
        guard isRecording, let startedAt, let recordID = activeRecordID else { return nil }

        sensorProvider.stop()
        sensorProvider.onSample = nil
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        updateElapsedTime()
        isRecording = false
        let endedAt = Date()
        let sourcePlanLocalId = activePlan.sourcePlanLocalId
        var sessionTags = activePlan.tags
        if let sourcePlanLocalId, !sessionTags.contains("plan-\(sourcePlanLocalId)") {
            sessionTags.append("plan-\(sourcePlanLocalId)")
        }

        let payload: DiveSessionPayload
        switch activePlan.diveMode {
        case .freedive:
            guard var engine = freeEngine else { return nil }
            let session = engine.finish(at: endedAt)
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
            payload = .scuba(engine.finish(at: endedAt))
        }
        currentRecordPayload = payload

        return DiveSessionRecord(
            id: recordID,
            schemaVersion: 2,
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

    func cancelSession() {
        sensorProvider.stop()
        sensorProvider.onSample = nil
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        currentRecordPayload = nil
        freeSnapshot = nil
        scubaSafetyStop = .legacyUnknown
        freeEngine = nil
        scubaEngine = nil
        isRecording = false
    }

    func setDemoDepthMeters(_ depthMeters: Double) {
        (sensorProvider as? DemoDepthSensorProvider)?.setDepthMeters(depthMeters)
    }

    private func append(_ sample: DepthSample) {
        guard sample.isValidRecordingSample else {
            return
        }

        let previousSample = samples.last
        samples.append(sample)
        currentDepth = sample.depthMeters
        maxDepth = max(maxDepth, sample.depthMeters)
        waterTemperatureCelsius = sample.waterTemperatureCelsius
        latestAscentRateMetersPerMinute = ascentRate(from: previousSample, to: sample)
        ascentWarningActive = latestAscentRateMetersPerMinute > recommendedAscentRateMetersPerMinute

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

        elapsedTime = max(0, Date().timeIntervalSince(startedAt))
    }

    private func ascentRate(from previous: DepthSample?, to current: DepthSample) -> Double {
        guard let previous else { return 0 }
        let elapsed = current.timestamp.timeIntervalSince(previous.timestamp)
        guard elapsed > 0, current.depthMeters < previous.depthMeters else { return 0 }
        return (previous.depthMeters - current.depthMeters) / elapsed * 60
    }
}
