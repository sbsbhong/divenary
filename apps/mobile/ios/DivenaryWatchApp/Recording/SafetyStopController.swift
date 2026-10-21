import Foundation

struct SafetyStopConfiguration: Equatable {
    var armDepthMeters: Double = 10
    var targetDepthMeters: Double = 5
    var displayMinDepthMeters: Double = 3
    var displayMaxDepthMeters: Double = 6
    var countingMinDepthMeters: Double = 2.7
    var countingMaxDepthMeters: Double = 6.3
    var durationSeconds: TimeInterval = 180
    var stableTransitionDuration: TimeInterval = 2
    var outOfZoneResetSeconds: TimeInterval = 30
    var maximumCreditedSampleInterval: TimeInterval = 5
}

struct SafetyStopController {
    private let configuration: SafetyStopConfiguration
    private var lastSample: DepthSample?
    private var startedAt: Date?
    private var outsideZoneStartedAt: Date?
    private var completedAt: Date?
    private var remainingSeconds: TimeInterval
    private var timeInZoneSeconds: TimeInterval = 0
    private var status: SafetyStopStatus = .notRequired

    init(configuration: SafetyStopConfiguration = SafetyStopConfiguration()) {
        self.configuration = configuration
        remainingSeconds = configuration.durationSeconds
    }

    var record: SafetyStopRecord {
        SafetyStopRecord(
            status: status,
            required: status != .notRequired && status != .unknown,
            completed: status == .completed,
            targetDepthMeters: configuration.targetDepthMeters,
            minDepthMeters: configuration.displayMinDepthMeters,
            maxDepthMeters: configuration.displayMaxDepthMeters,
            durationSeconds: configuration.durationSeconds,
            startedAt: startedAt,
            completedAt: completedAt,
            remainingSeconds: remainingSeconds,
            timeInZoneSeconds: timeInZoneSeconds
        )
    }

    mutating func update(maxDepthMeters: Double, sample: DepthSample) {
        defer { lastSample = sample }

        if status == .completed {
            guard sample.depthMeters >= configuration.armDepthMeters else { return }
            rearmCompletedStop()
        }

        guard status != .skippedOrIncomplete else {
            return
        }

        guard maxDepthMeters >= configuration.armDepthMeters else {
            return
        }

        if status == .notRequired {
            status = .armed
        }

        let wasActive = status == .active

        switch zoneStatus(for: sample.depthMeters) {
        case .inside:
            outsideZoneStartedAt = nil
            if startedAt == nil {
                startedAt = sample.timestamp
            }
            let elapsed = wasActive ? elapsedSinceLastSample(to: sample) : 0
            // Time between samples beyond the live cadence was not observed, so it never counts.
            let observedElapsed = min(elapsed, configuration.maximumCreditedSampleInterval)
            let creditedElapsed = min(observedElapsed, remainingSeconds)
            remainingSeconds = max(0, remainingSeconds - creditedElapsed)
            timeInZoneSeconds += creditedElapsed
            status = remainingSeconds <= 0 ? .completed : .active
            if status == .completed {
                completedAt = sample.timestamp.addingTimeInterval(-(elapsed - creditedElapsed))
            }
        case .tooDeep:
            updateOutsideZoneState(status: .pausedTooDeep, sample: sample)
        case .tooShallow:
            updateOutsideZoneState(status: .pausedTooShallow, sample: sample)
        }
    }

    mutating func markSurfaced(at _: Date) {
        guard status != .completed && status != .notRequired else { return }
        status = .skippedOrIncomplete
    }

    private mutating func rearmCompletedStop() {
        startedAt = nil
        outsideZoneStartedAt = nil
        completedAt = nil
        remainingSeconds = configuration.durationSeconds
        timeInZoneSeconds = 0
        status = .armed
    }

    private func elapsedSinceLastSample(to sample: DepthSample) -> TimeInterval {
        guard let lastSample else { return 0 }
        return max(0, sample.timestamp.timeIntervalSince(lastSample.timestamp))
    }

    private mutating func updateOutsideZoneState(status nextStatus: SafetyStopStatus, sample: DepthSample) {
        guard startedAt != nil || outsideZoneStartedAt != nil else { return }

        if outsideZoneStartedAt == nil {
            outsideZoneStartedAt = sample.timestamp
        }

        status = nextStatus

        guard let outsideZoneStartedAt else { return }
        let elapsedOutsideZone = max(0, sample.timestamp.timeIntervalSince(outsideZoneStartedAt))
        guard elapsedOutsideZone >= configuration.outOfZoneResetSeconds else { return }

        remainingSeconds = configuration.durationSeconds
        timeInZoneSeconds = 0
        startedAt = nil
    }

    private func zoneStatus(for depth: Double) -> ZoneStatus {
        if depth < configuration.countingMinDepthMeters {
            return .tooShallow
        }
        if depth > configuration.countingMaxDepthMeters {
            return .tooDeep
        }
        return .inside
    }

    private enum ZoneStatus {
        case inside
        case tooDeep
        case tooShallow
    }
}

extension SafetyStopStatus: CaseIterable {
    static let allCases: [SafetyStopStatus] = [
        .unknown,
        .notRequired,
        .armed,
        .active,
        .pausedTooDeep,
        .pausedTooShallow,
        .completed,
        .skippedOrIncomplete,
    ]

    var displayText: String {
        switch self {
        case .unknown:
            return String(localized: "Stop status unavailable")
        case .notRequired:
            return String(localized: "No reminder recorded")
        case .armed:
            return String(localized: "Stop reminder armed")
        case .active:
            return String(localized: "Within stop zone")
        case .pausedTooDeep:
            return String(localized: "Deeper than stop zone")
        case .pausedTooShallow:
            return String(localized: "Shallower than stop zone")
        case .completed:
            return String(localized: "Recommended stop complete")
        case .skippedOrIncomplete:
            return String(localized: "Stop incomplete")
        }
    }
}
