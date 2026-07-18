import WatchKit
import XCTest
@testable import DivenaryWatchApp

@MainActor
final class DiveRuntimeSessionControllerTests: XCTestCase {
    func testManualStartAssignsDelegateBeforeAdapterStart() {
        let adapter = FakeRuntimeSessionAdapter()
        let controller = DiveRuntimeSessionController(
            factory: RecordingRuntimeSessionAdapterFactory(manualAdapters: [adapter])
        )

        XCTAssertTrue(controller.startManualSession())

        XCTAssertEqual(adapter.calls, [.setDelegate, .start])
    }

    func testManualStartReturnsFalseWhileAnAdapterIsActive() {
        let adapter = FakeRuntimeSessionAdapter()
        let controller = DiveRuntimeSessionController(
            factory: RecordingRuntimeSessionAdapterFactory(manualAdapters: [adapter])
        )

        XCTAssertTrue(controller.startManualSession())
        XCTAssertFalse(controller.startManualSession())

        XCTAssertEqual(adapter.calls, [.setDelegate, .start])
    }

    func testAdoptedSystemSessionAttachesDelegateWithoutStartingAndEmitsImmediately() {
        let adapter = FakeRuntimeSessionAdapter()
        let factory = RecordingRuntimeSessionAdapterFactory(adoptedAdapters: [adapter])
        let controller = DiveRuntimeSessionController(factory: factory)
        var eventNames: [String] = []
        controller.onEvent = { eventNames.append(self.name(for: $0)) }
        let session = WKExtendedRuntimeSession()

        controller.adoptSystemSession(session)

        XCTAssertEqual(adapter.calls, [.setDelegate])
        XCTAssertTrue(factory.adoptedSessions.first === session)
        XCTAssertEqual(eventNames, ["adoptedSystemSession"])
    }

    func testConcreteAdoptionImmediatelyAttachesAdapterAsSystemSessionDelegate() {
        let session = WKExtendedRuntimeSession()
        let controller = DiveRuntimeSessionController()

        controller.adoptSystemSession(session)

        guard let adapter = session.delegate as? WatchExtendedRuntimeSessionAdapter else {
            return XCTFail("Expected the production runtime adapter as the system session delegate")
        }
        XCTAssertTrue(session.delegate === adapter)
    }

    func testActiveAdapterForwardsOrderedLifecycleAndOnlyOneInvalidation() {
        let adapter = FakeRuntimeSessionAdapter()
        let controller = DiveRuntimeSessionController(
            factory: RecordingRuntimeSessionAdapterFactory(manualAdapters: [adapter])
        )
        var events: [DiveRuntimeEvent] = []
        controller.onEvent = { events.append($0) }

        controller.startManualSession()
        adapter.emitDidStart()
        adapter.emitWillExpire()
        adapter.emitInvalidation(reason: .expired, error: TestError.runtime)
        adapter.emitInvalidation(reason: .error, error: TestError.runtime)

        XCTAssertEqual(events.map(name(for:)), ["didStart", "willExpire", "didInvalidate"])
        guard case let .didInvalidate(reason, errorDescription) = events.last else {
            return XCTFail("Expected invalidation event")
        }
        XCTAssertEqual(reason, .expired)
        XCTAssertEqual(errorDescription, TestError.runtime.localizedDescription)
    }

    func testInvalidateCallsActiveAdapterOnceUntilItInvalidates() {
        let adapter = FakeRuntimeSessionAdapter()
        let controller = DiveRuntimeSessionController(
            factory: RecordingRuntimeSessionAdapterFactory(manualAdapters: [adapter])
        )
        controller.startManualSession()

        controller.invalidate()
        controller.invalidate()

        XCTAssertEqual(adapter.calls, [.setDelegate, .start, .invalidate])
    }

    func testExplicitInvalidationSuppressesDuplicatesResetsAfterCallbackAndStartsReplacement() {
        let firstAdapter = FakeRuntimeSessionAdapter()
        let secondAdapter = FakeRuntimeSessionAdapter()
        let factory = RecordingRuntimeSessionAdapterFactory(manualAdapters: [firstAdapter, secondAdapter])
        let controller = DiveRuntimeSessionController(factory: factory)

        controller.startManualSession()
        controller.invalidate()
        controller.invalidate()
        firstAdapter.emitInvalidation(reason: .none, error: nil)
        controller.startManualSession()

        XCTAssertEqual(firstAdapter.calls, [.setDelegate, .start, .invalidate])
        XCTAssertEqual(secondAdapter.calls, [.setDelegate, .start])
    }

    func testInvalidationClearsActiveAdapterAndStaleCallbacksDoNotCorruptReplacement() {
        let firstAdapter = FakeRuntimeSessionAdapter()
        let secondAdapter = FakeRuntimeSessionAdapter()
        let factory = RecordingRuntimeSessionAdapterFactory(manualAdapters: [firstAdapter, secondAdapter])
        let controller = DiveRuntimeSessionController(factory: factory)
        var eventNames: [String] = []
        controller.onEvent = { eventNames.append(self.name(for: $0)) }

        controller.startManualSession()
        firstAdapter.emitInvalidation(reason: .none, error: nil)
        controller.startManualSession()
        secondAdapter.emitDidStart()
        firstAdapter.emitWillExpire()
        firstAdapter.emitInvalidation(reason: .expired, error: nil)

        XCTAssertEqual(firstAdapter.calls, [.setDelegate, .start])
        XCTAssertEqual(secondAdapter.calls, [.setDelegate, .start])
        XCTAssertEqual(eventNames, ["didInvalidate", "didStart"])
    }

    func testMatchingInvalidationClearsAdapterBeforePublishingEvent() {
        let firstAdapter = FakeRuntimeSessionAdapter()
        let secondAdapter = FakeRuntimeSessionAdapter()
        let controller = DiveRuntimeSessionController(
            factory: RecordingRuntimeSessionAdapterFactory(
                manualAdapters: [firstAdapter, secondAdapter]
            )
        )
        var replacementStarted = false
        controller.onEvent = { event in
            guard case .didInvalidate = event else { return }
            replacementStarted = controller.startManualSession()
        }

        XCTAssertTrue(controller.startManualSession())
        firstAdapter.emitInvalidation(reason: .none, error: nil)

        XCTAssertTrue(replacementStarted)
        XCTAssertEqual(secondAdapter.calls, [.setDelegate, .start])
    }

    private func name(for event: DiveRuntimeEvent) -> String {
        switch event {
        case .adoptedSystemSession:
            return "adoptedSystemSession"
        case .didStart:
            return "didStart"
        case .willExpire:
            return "willExpire"
        case .didInvalidate:
            return "didInvalidate"
        }
    }

    private enum TestError: LocalizedError {
        case runtime

        var errorDescription: String? {
            "runtime error"
        }
    }
}

@MainActor
private final class RecordingRuntimeSessionAdapterFactory: DiveRuntimeSessionAdapterFactory {
    private var manualAdapters: [FakeRuntimeSessionAdapter]
    private var adoptedAdapters: [FakeRuntimeSessionAdapter]
    private(set) var adoptedSessions: [WKExtendedRuntimeSession] = []

    init(
        manualAdapters: [FakeRuntimeSessionAdapter] = [],
        adoptedAdapters: [FakeRuntimeSessionAdapter] = []
    ) {
        self.manualAdapters = manualAdapters
        self.adoptedAdapters = adoptedAdapters
    }

    func makeManualAdapter() -> DiveRuntimeSessionAdapter {
        manualAdapters.removeFirst()
    }

    func makeAdapter(for session: WKExtendedRuntimeSession) -> DiveRuntimeSessionAdapter {
        adoptedSessions.append(session)
        return adoptedAdapters.removeFirst()
    }
}

@MainActor
private final class FakeRuntimeSessionAdapter: DiveRuntimeSessionAdapter {
    enum Call: Equatable {
        case setDelegate
        case start
        case invalidate
    }

    weak var delegate: DiveRuntimeSessionAdapterDelegate? {
        didSet {
            calls.append(.setDelegate)
        }
    }

    private(set) var calls: [Call] = []

    func start() {
        calls.append(.start)
    }

    func invalidate() {
        calls.append(.invalidate)
    }

    func emitDidStart() {
        delegate?.runtimeAdapterDidStart(self)
    }

    func emitWillExpire() {
        delegate?.runtimeAdapterWillExpire(self)
    }

    func emitInvalidation(
        reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    ) {
        delegate?.runtimeAdapter(self, didInvalidateWith: reason, error: error)
    }
}
