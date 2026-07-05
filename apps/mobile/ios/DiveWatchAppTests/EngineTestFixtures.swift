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
        temperature: Double = 24
    ) -> DepthSample {
        DepthSample(
            timestamp: date(secondsAfterStart),
            depthMeters: depth,
            pressureKPa: 101.325 + depth * 9.80665,
            waterTemperatureCelsius: temperature
        )
    }
}
