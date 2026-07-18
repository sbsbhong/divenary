import Foundation
import WatchKit

enum DiveRuntimeEvent {
    case adoptedSystemSession
    case didStart
    case willExpire
    case didInvalidate(
        reason: WKExtendedRuntimeSessionInvalidationReason,
        errorDescription: String?
    )
}

@MainActor
protocol DiveRuntimeSessionAdapterDelegate: AnyObject {
    func runtimeAdapterDidStart(_ adapter: DiveRuntimeSessionAdapter)
    func runtimeAdapterWillExpire(_ adapter: DiveRuntimeSessionAdapter)
    func runtimeAdapter(
        _ adapter: DiveRuntimeSessionAdapter,
        didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    )
}

@MainActor
protocol DiveRuntimeSessionAdapter: AnyObject {
    var delegate: DiveRuntimeSessionAdapterDelegate? { get set }
    func start()
    func invalidate()
}

@MainActor
protocol DiveRuntimeSessionAdapterFactory: AnyObject {
    func makeManualAdapter() -> DiveRuntimeSessionAdapter
    func makeAdapter(for session: WKExtendedRuntimeSession) -> DiveRuntimeSessionAdapter
}

@MainActor
protocol DiveRuntimeSessionControlling: AnyObject {
    var onEvent: ((DiveRuntimeEvent) -> Void)? { get set }
    @discardableResult
    func startManualSession() -> Bool
    func adoptSystemSession(_ session: WKExtendedRuntimeSession)
    func invalidate()
}

@MainActor
final class DiveRuntimeSessionController: DiveRuntimeSessionControlling {
    var onEvent: ((DiveRuntimeEvent) -> Void)?

    private let factory: DiveRuntimeSessionAdapterFactory
    private var activeAdapter: DiveRuntimeSessionAdapter?
    private var isInvalidating = false

    init(factory: DiveRuntimeSessionAdapterFactory? = nil) {
        self.factory = factory ?? WatchExtendedRuntimeSessionAdapterFactory()
    }

    @discardableResult
    func startManualSession() -> Bool {
        guard activeAdapter == nil else {
            return false
        }

        let adapter = factory.makeManualAdapter()
        adapter.delegate = self
        activeAdapter = adapter
        adapter.start()
        return true
    }

    func adoptSystemSession(_ session: WKExtendedRuntimeSession) {
        let adapter = factory.makeAdapter(for: session)
        adapter.delegate = self
        activeAdapter = adapter
        isInvalidating = false
        onEvent?(.adoptedSystemSession)
    }

    func invalidate() {
        guard let activeAdapter, !isInvalidating else {
            return
        }

        isInvalidating = true
        activeAdapter.invalidate()
    }

    private func isActive(_ adapter: DiveRuntimeSessionAdapter) -> Bool {
        activeAdapter === adapter
    }
}

extension DiveRuntimeSessionController: DiveRuntimeSessionAdapterDelegate {
    func runtimeAdapterDidStart(_ adapter: DiveRuntimeSessionAdapter) {
        guard isActive(adapter) else {
            return
        }

        onEvent?(.didStart)
    }

    func runtimeAdapterWillExpire(_ adapter: DiveRuntimeSessionAdapter) {
        guard isActive(adapter) else {
            return
        }

        onEvent?(.willExpire)
    }

    func runtimeAdapter(
        _ adapter: DiveRuntimeSessionAdapter,
        didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    ) {
        guard isActive(adapter) else {
            return
        }

        activeAdapter = nil
        isInvalidating = false
        onEvent?(.didInvalidate(reason: reason, errorDescription: error?.localizedDescription))
    }
}

@MainActor
final class WatchExtendedRuntimeSessionAdapterFactory: DiveRuntimeSessionAdapterFactory {
    func makeManualAdapter() -> DiveRuntimeSessionAdapter {
        WatchExtendedRuntimeSessionAdapter(session: WKExtendedRuntimeSession())
    }

    func makeAdapter(for session: WKExtendedRuntimeSession) -> DiveRuntimeSessionAdapter {
        WatchExtendedRuntimeSessionAdapter(session: session)
    }
}

@MainActor
final class WatchExtendedRuntimeSessionAdapter: NSObject, DiveRuntimeSessionAdapter {
    weak var delegate: DiveRuntimeSessionAdapterDelegate?

    private let session: WKExtendedRuntimeSession

    init(session: WKExtendedRuntimeSession) {
        self.session = session
        super.init()
        session.delegate = self
    }

    func start() {
        session.start()
    }

    func invalidate() {
        session.invalidate()
    }
}

extension WatchExtendedRuntimeSessionAdapter: WKExtendedRuntimeSessionDelegate {
    nonisolated func extendedRuntimeSessionDidStart(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            delegate?.runtimeAdapterDidStart(self)
        }
    }

    nonisolated func extendedRuntimeSessionWillExpire(_ extendedRuntimeSession: WKExtendedRuntimeSession) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            delegate?.runtimeAdapterWillExpire(self)
        }
    }

    nonisolated func extendedRuntimeSession(
        _ extendedRuntimeSession: WKExtendedRuntimeSession,
        didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            delegate?.runtimeAdapter(self, didInvalidateWith: reason, error: error)
        }
    }
}
