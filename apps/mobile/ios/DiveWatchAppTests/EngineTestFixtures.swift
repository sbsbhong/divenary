import Foundation
@testable import DiveWatchApp

enum EngineTestFixtures {
    static let start = Date(timeIntervalSince1970: 1_783_225_525)

    static func date(_ secondsAfterStart: TimeInterval) -> Date {
        start.addingTimeInterval(secondsAfterStart)
    }

    static func sample(
        _ secondsAfterStart: TimeInterval,
        depth: Double,
        temperature: Double = 24,
        id: UUID? = nil
    ) -> DepthSample {
        DepthSample(
            id: id ?? sampleID(secondsAfterStart),
            timestamp: date(secondsAfterStart),
            depthMeters: depth,
            pressureKPa: 101.325 + depth * 9.80665,
            waterTemperatureCelsius: temperature
        )
    }

    private static func sampleID(_ secondsAfterStart: TimeInterval) -> UUID {
        let milliseconds = UInt64((secondsAfterStart * 1_000).rounded())
        let uuidString = String(format: "00000000-0000-0000-0000-%012llX", milliseconds)
        return UUID(uuidString: uuidString)!
    }
}
