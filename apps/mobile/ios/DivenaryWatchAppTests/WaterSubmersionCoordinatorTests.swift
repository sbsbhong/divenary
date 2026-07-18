import CoreMotion
import XCTest
@testable import DivenaryWatchApp

@MainActor
final class WaterSubmersionCoordinatorTests: XCTestCase {
    func testMapsEverySubmersionEventState() {
        XCTAssertEqual(WaterSubmersionCoordinator.waterState(for: .unknown), .unknown)
        XCTAssertEqual(WaterSubmersionCoordinator.waterState(for: .notSubmerged), .notSubmerged)
        XCTAssertEqual(WaterSubmersionCoordinator.waterState(for: .submerged), .submerged)
    }

    func testMapsEverySubmersionDepthState() {
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .unknown), .unknown)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .notSubmerged), .notSubmerged)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .submergedShallow), .submergedShallow)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .submergedDeep), .submergedDeep)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .approachingMaxDepth), .approachingMaxDepth)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .pastMaxDepth), .pastMaxDepth)
        XCTAssertEqual(WaterSubmersionCoordinator.depthState(for: .sensorDepthError), .sensorDepthError)
    }

    func testValidMeasurementProducesSampleUsingLatestTemperature() throws {
        let result = WaterSubmersionCoordinator.makeSample(
            timestamp: date(4),
            depthMeters: 0.15,
            pressureKPa: 102.8,
            temperatureCelsius: 18.4,
            depthState: .submergedShallow
        )
        let sample = try XCTUnwrap(result)
        XCTAssertEqual(sample.depthMeters, 0.15, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(sample.waterTemperatureCelsius), 18.4, accuracy: 0.001)
    }

    func testMeasurementReusesLatestValidTemperature() throws {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        var receivedSamples: [DepthSample] = []
        coordinator.onSample = { receivedSamples.append($0) }

        coordinator.receiveTemperature(celsius: 18.4)
        coordinator.receiveMeasurement(
            timestamp: date(4),
            depthMeters: 0.15,
            pressureKPa: 102.8,
            depthState: .submergedShallow
        )

        let sample = try XCTUnwrap(receivedSamples.first)
        XCTAssertEqual(try XCTUnwrap(sample.waterTemperatureCelsius), 18.4, accuracy: 0.001)
    }

    func testMissingDepthOrPressureDoesNotProduceSample() {
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: nil, pressureKPa: 101.3,
            temperatureCelsius: nil, depthState: .submergedShallow
        ))
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: nil,
            temperatureCelsius: nil, depthState: .submergedShallow
        ))
    }

    func testNonFiniteDepthOrPressureDoesNotProduceSampleAndNonFiniteTemperatureIsOmitted() throws {
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: .infinity, pressureKPa: 101.3,
            temperatureCelsius: 18.4, depthState: .submergedShallow
        ))
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: .nan,
            temperatureCelsius: 18.4, depthState: .submergedShallow
        ))

        let sample = try XCTUnwrap(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: 101.3,
            temperatureCelsius: -.infinity, depthState: .submergedShallow
        ))
        XCTAssertNil(sample.waterTemperatureCelsius)
    }

    func testSensorDepthErrorDoesNotProduceSample() {
        XCTAssertNil(WaterSubmersionCoordinator.makeSample(
            timestamp: date(1), depthMeters: 0.1, pressureKPa: 101.3,
            temperatureCelsius: 18.4, depthState: .sensorDepthError
        ))
    }

    func testEventUpdatesStateAndForwardsTimestamp() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        var receivedEvent: (WaterSubmersionState, Date)?
        coordinator.onEvent = { receivedEvent = ($0, $1) }

        coordinator.receiveEvent(state: .submerged, at: date(2))

        XCTAssertEqual(coordinator.latestState, .submerged)
        XCTAssertEqual(receivedEvent?.0, .submerged)
        XCTAssertEqual(receivedEvent?.1, date(2))
    }

    func testErrorIsForwarded() {
        let coordinator = WaterSubmersionCoordinator(managerFactory: { nil })
        var receivedError: Error?
        coordinator.onError = { receivedError = $0 }

        coordinator.receive(error: TestError.expected)

        XCTAssertEqual(receivedError as? TestError, .expected)
    }

    func testUnavailableManagerDoesNotStartMonitoring() {
        var factoryInvocationCount = 0
        let coordinator = WaterSubmersionCoordinator(managerFactory: {
            factoryInvocationCount += 1
            return nil
        })

        coordinator.startMonitoring()

        XCTAssertEqual(factoryInvocationCount, 1)
        XCTAssertEqual(coordinator.latestState, .unknown)
        XCTAssertNil(coordinator.maximumDepthMeters)
    }

    func testRepeatedStartMonitoringCreatesAtMostOneManager() {
        var factoryInvocationCount = 0
        let coordinator = WaterSubmersionCoordinator(managerFactory: {
            factoryInvocationCount += 1
            return nil
        })

        coordinator.startMonitoring()
        coordinator.startMonitoring()

        XCTAssertEqual(factoryInvocationCount, 1)
    }

    func testMaximumDepthConvertsAuthorizedLengthToMeters() throws {
        let maximumDepth = Measurement(value: 20, unit: UnitLength.feet)
        let meters = try XCTUnwrap(WaterSubmersionCoordinator.maximumDepthMeters(from: maximumDepth))

        XCTAssertEqual(meters, 6.096, accuracy: 0.001)
    }

    private func date(_ seconds: TimeInterval) -> Date {
        EngineTestFixtures.date(seconds)
    }

    private enum TestError: Error, Equatable {
        case expected
    }
}
