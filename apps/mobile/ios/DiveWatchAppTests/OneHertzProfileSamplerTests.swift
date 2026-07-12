import XCTest
@testable import DiveWatchApp

final class OneHertzProfileSamplerTests: XCTestCase {
    func testFinalizesOneRepresentativeWithExtremaPerNonEmptySecond() throws {
        var sampler = OneHertzProfileSampler(startedAt: EngineTestFixtures.start)

        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.1, depth: 2, temperature: nil)))
        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.7, depth: 5, temperature: 23)))

        let first = try XCTUnwrap(sampler.append(EngineTestFixtures.sample(1.2, depth: 4, temperature: 24)))

        XCTAssertEqual(first.timestamp, EngineTestFixtures.date(0.7))
        XCTAssertEqual(first.depthMeters, 5)
        XCTAssertEqual(first.bucketMinDepthMeters, 2)
        XCTAssertEqual(first.bucketMaxDepthMeters, 5)
        XCTAssertEqual(first.waterTemperatureCelsius, 23)
    }

    func testSkipsEmptySecondsWithoutSynthesizingSamples() throws {
        var sampler = OneHertzProfileSampler(startedAt: EngineTestFixtures.start)

        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.2, depth: 2)))
        let first = try XCTUnwrap(sampler.append(EngineTestFixtures.sample(10.2, depth: 7)))
        let last = try XCTUnwrap(sampler.finish())

        XCTAssertEqual(first.timestamp, EngineTestFixtures.date(0.2))
        XCTAssertEqual(last.timestamp, EngineTestFixtures.date(10.2))
        XCTAssertNil(sampler.finish())
    }

    func testKeepsLatestMeasuredTemperatureWhenLaterCallbackOmitsIt() throws {
        var sampler = OneHertzProfileSampler(startedAt: EngineTestFixtures.start)

        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.1, depth: 2, temperature: 21)))
        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.8, depth: 3, temperature: nil)))

        let sample = try XCTUnwrap(sampler.finish())
        XCTAssertEqual(sample.depthMeters, 3)
        XCTAssertEqual(sample.waterTemperatureCelsius, 21)
        XCTAssertEqual(sample.pressureKPa, EngineTestFixtures.sample(0.8, depth: 3).pressureKPa)
    }

    func testRejectsInvalidBeforeStartAndOutOfOrderCallbacks() throws {
        var sampler = OneHertzProfileSampler(startedAt: EngineTestFixtures.start)

        XCTAssertNil(sampler.append(DepthSample(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            timestamp: EngineTestFixtures.start.addingTimeInterval(-0.1),
            depthMeters: 9,
            pressureKPa: 189.58485,
            waterTemperatureCelsius: 24
        )))
        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.6, depth: 4)))
        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.2, depth: 12)))
        XCTAssertNil(sampler.append(EngineTestFixtures.sample(0.8, depth: .nan)))

        let sample = try XCTUnwrap(sampler.finish())
        XCTAssertEqual(sample.depthMeters, 4)
        XCTAssertEqual(sample.bucketMinDepthMeters, 4)
        XCTAssertEqual(sample.bucketMaxDepthMeters, 4)
    }

    func testBoundsThreeHoursToAtMostOneSamplePerSecond() {
        var sampler = OneHertzProfileSampler(startedAt: EngineTestFixtures.start)
        var persisted: [DepthSample] = []

        for second in 0..<(3 * 60 * 60) {
            for fraction in [0.1, 0.5, 0.9] {
                if let finalized = sampler.append(
                    EngineTestFixtures.sample(Double(second) + fraction, depth: Double(second % 30))
                ) {
                    persisted.append(finalized)
                }
            }
        }
        if let finalized = sampler.finish() {
            persisted.append(finalized)
        }

        XCTAssertEqual(persisted.count, 10_800)
        XCTAssertEqual(Set(persisted.map { Int($0.timestamp.timeIntervalSince(EngineTestFixtures.start)) }).count, 10_800)
    }
}
