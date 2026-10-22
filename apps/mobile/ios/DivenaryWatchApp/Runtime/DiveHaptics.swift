import WatchKit

/// Haptic confirmations for things the diver did. Automatic changes (page returns, freedive phase,
/// recommended stop, depth signal, Always-On) never play one. Sensor failure, recommended stop and
/// ascent cues are left out on purpose: the safety rules require a review before adding them.
enum DiveHapticEvent: Equatable {
    case start
    case pageChange
    case rejected
    case endRequested
    case saved

    fileprivate var hapticType: WKHapticType {
        switch self {
        case .start:
            return .start
        case .pageChange:
            return .click
        case .rejected:
            return .failure
        case .endRequested:
            return .stop
        case .saved:
            return .success
        }
    }
}

@MainActor
protocol DiveHapticPlaying: AnyObject {
    func play(_ event: DiveHapticEvent)
}

/// The only caller of `WKInterfaceDevice.play`. Views add no `sensoryFeedback` or `play` of their own;
/// the system's Digital Crown detents are the only other haptic.
@MainActor
final class WatchDiveHaptics: DiveHapticPlaying {
    func play(_ event: DiveHapticEvent) {
        WKInterfaceDevice.current().play(event.hapticType)
    }
}
