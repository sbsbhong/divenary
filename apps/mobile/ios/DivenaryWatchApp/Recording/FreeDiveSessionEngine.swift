import Foundation

struct FreeDiveSegmentationConfiguration: Equatable {
    var diveStartDepthThreshold: Double = 1.2
    var surfaceDepthThreshold: Double = 0.8
    var sustainedDescentDuration: TimeInterval = 3
    var surfaceConfirmDuration: TimeInterval = 4
}

enum FreeDiveSessionState: Equatable {
    case surfaceReady
    case diveActive
    case surfaceInterval
    case summary
}

struct FreeDiveSessionSnapshot: Equatable {
    var state: FreeDiveSessionState
    var segments: [FreeDiveSegment]
    var activeSegment: FreeDiveSegment?
    var diveCount: Int
    var maxDepthMeters: Double
    var currentDepthMeters: Double
}

struct FreeDiveSessionEngine {
    private let startedAt: Date
    private let configuration: FreeDiveSegmentationConfiguration
    private var samples: [DepthSample] = []
    private var segments: [FreeDiveSegment] = []
    private var activeSegmentID: UUID?
    private var activeStartIndex: Int?
    private var sustainedDescentSegmentStartIndex: Int?
    private var sustainedDescentStartedAt: Date?
    private var surfaceCandidateStartedAt: Date?
    private(set) var state: FreeDiveSessionState = .surfaceReady

    init(
        startedAt: Date,
        configuration: FreeDiveSegmentationConfiguration = FreeDiveSegmentationConfiguration()
    ) {
        self.startedAt = startedAt
        self.configuration = configuration
    }

    var snapshot: FreeDiveSessionSnapshot {
        let active = activeSegment
        return FreeDiveSessionSnapshot(
            state: state,
            segments: segments,
            activeSegment: active,
            diveCount: segments.count + (active == nil ? 0 : 1),
            maxDepthMeters: max(segments.map(\.maxDepthMeters).max() ?? 0, active?.maxDepthMeters ?? 0),
            currentDepthMeters: samples.last?.depthMeters ?? 0
        )
    }

    var activeSegment: FreeDiveSegment? {
        guard let activeSegmentID, let activeStartIndex, activeStartIndex < samples.count, let latest = samples.last else {
            return nil
        }

        let segmentSamples = Array(samples[activeStartIndex..<samples.count])
        return makeSegment(
            id: activeSegmentID,
            index: segments.count + 1,
            startIndex: activeStartIndex,
            endIndex: samples.count - 1,
            endTime: latest.timestamp,
            samples: segmentSamples
        )
    }

    mutating func append(_ sample: DepthSample) {
        guard sample.isValidRecordingSample else {
            return
        }

        guard state != .summary else {
            return
        }

        samples.append(sample)

        switch state {
        case .surfaceReady, .surfaceInterval:
            updateSurfaceState(with: sample)
        case .diveActive:
            updateDiveState(with: sample)
        case .summary:
            return
        }
    }

    func surfaceInterval(at date: Date) -> TimeInterval {
        guard let previousEnd = segments.last?.endTime else { return 0 }
        return max(0, date.timeIntervalSince(previousEnd))
    }

    mutating func finish(at date: Date) -> FreeDiveSession {
        if let active = activeSegment {
            segments.append(
                FreeDiveSegment(
                    id: active.id,
                    index: active.index,
                    startTime: active.startTime,
                    endTime: date,
                    durationSeconds: max(0, date.timeIntervalSince(active.startTime)),
                    maxDepthMeters: active.maxDepthMeters,
                    minDepthMeters: active.minDepthMeters,
                    sampleStartIndex: active.sampleStartIndex,
                    sampleEndIndex: active.sampleEndIndex,
                    descentRateMetersPerSecond: active.descentRateMetersPerSecond,
                    ascentRateMetersPerSecond: active.ascentRateMetersPerSecond
                )
            )
        }

        activeSegmentID = nil
        activeStartIndex = nil
        sustainedDescentSegmentStartIndex = nil
        sustainedDescentStartedAt = nil
        surfaceCandidateStartedAt = nil
        state = .summary

        return makeSession(endedAt: date)
    }

    private mutating func updateSurfaceState(with sample: DepthSample) {
        guard sample.depthMeters >= configuration.diveStartDepthThreshold else {
            sustainedDescentSegmentStartIndex = nil
            sustainedDescentStartedAt = nil
            return
        }

        let currentIndex = samples.count - 1
        let previousIndex = currentIndex - 1

        if sustainedDescentStartedAt == nil || isSparseCandidate(previousIndex: previousIndex, sample: sample) {
            if previousIndex >= 0,
               samples[previousIndex].depthMeters < configuration.diveStartDepthThreshold,
               sample.timestamp.timeIntervalSince(samples[previousIndex].timestamp) <= configuration.sustainedDescentDuration {
                sustainedDescentSegmentStartIndex = previousIndex
            } else {
                sustainedDescentSegmentStartIndex = currentIndex
            }
            sustainedDescentStartedAt = sample.timestamp
        }

        guard let descentStart = sustainedDescentStartedAt,
              sample.timestamp.timeIntervalSince(descentStart) >= configuration.sustainedDescentDuration else {
            return
        }

        activeSegmentID = UUID()
        activeStartIndex = sustainedDescentSegmentStartIndex ?? max(0, samples.count - 1)
        surfaceCandidateStartedAt = nil
        state = .diveActive
    }

    private mutating func updateDiveState(with sample: DepthSample) {
        guard sample.depthMeters <= configuration.surfaceDepthThreshold else {
            surfaceCandidateStartedAt = nil
            return
        }

        if surfaceCandidateStartedAt == nil {
            surfaceCandidateStartedAt = sample.timestamp
        }

        guard let surfaceStart = surfaceCandidateStartedAt,
              sample.timestamp.timeIntervalSince(surfaceStart) >= configuration.surfaceConfirmDuration,
              let active = activeSegment else {
            return
        }

        segments.append(active)
        activeSegmentID = nil
        activeStartIndex = nil
        sustainedDescentSegmentStartIndex = nil
        sustainedDescentStartedAt = nil
        surfaceCandidateStartedAt = nil
        state = .surfaceInterval
    }

    private func isSparseCandidate(previousIndex: Int, sample: DepthSample) -> Bool {
        guard previousIndex >= 0,
              samples[previousIndex].depthMeters >= configuration.diveStartDepthThreshold else {
            return false
        }

        return sample.timestamp.timeIntervalSince(samples[previousIndex].timestamp) > configuration.sustainedDescentDuration
    }

    private func makeSession(endedAt: Date) -> FreeDiveSession {
        FreeDiveSession(
            id: UUID(),
            startTime: startedAt,
            endTime: endedAt,
            totalDurationSeconds: max(0, endedAt.timeIntervalSince(startedAt)),
            maxDepthMeters: segments.map(\.maxDepthMeters).max() ?? 0,
            diveCount: segments.count,
            longestDiveDurationSeconds: segments.map(\.durationSeconds).max() ?? 0,
            segments: segments
        )
    }

    private func makeSegment(
        id: UUID,
        index: Int,
        startIndex: Int,
        endIndex: Int,
        endTime: Date,
        samples segmentSamples: [DepthSample]
    ) -> FreeDiveSegment {
        let start = segmentSamples.first?.timestamp ?? endTime
        return FreeDiveSegment(
            id: id,
            index: index,
            startTime: start,
            endTime: endTime,
            durationSeconds: max(0, endTime.timeIntervalSince(start)),
            maxDepthMeters: segmentSamples.map(\.depthMeters).max() ?? 0,
            minDepthMeters: segmentSamples.map(\.depthMeters).min() ?? 0,
            sampleStartIndex: startIndex,
            sampleEndIndex: endIndex,
            descentRateMetersPerSecond: nil,
            ascentRateMetersPerSecond: nil
        )
    }
}
