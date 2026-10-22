import SwiftUI

struct WetReadyStartGuidance {
    let autoLaunchStatus: DepthAutoLaunchStatus
    let hasActionButton: Bool

    static var notRecordingText: String { String(localized: "Not recording yet") }

    var showsHomeButton: Bool { true }

    var text: String {
        if autoLaunchStatus == .active {
            return String(localized: "Recording starts when watchOS starts the dive session.")
        }
        if hasActionButton {
            return String(localized: "If you assigned Divenary to the Action Button, press it to start recording.")
        }
        return String(localized: "Start recording from Home.")
    }
}

/// Shown when the watch is submerged before a recording starts. Submersion alone never starts a
/// recording, so the screen says which start path this watch has: watchOS auto-launch, the Action
/// Button (only a hint, the assignment cannot be read), or a return to Home to start.
struct WetReadyView: View {
    let mode: DiveMode
    let currentDepthMeters: Double?
    let autoLaunchStatus: DepthAutoLaunchStatus
    let hasActionButton: Bool
    let onSelect: (DiveMode) -> Void
    let onHome: () -> Void

    @State private var crownValue: Double
    @FocusState private var crownFocused: Bool

    init(
        mode: DiveMode,
        currentDepthMeters: Double?,
        autoLaunchStatus: DepthAutoLaunchStatus,
        hasActionButton: Bool,
        onSelect: @escaping (DiveMode) -> Void,
        onHome: @escaping () -> Void
    ) {
        self.mode = mode
        self.currentDepthMeters = currentDepthMeters
        self.autoLaunchStatus = autoLaunchStatus
        self.hasActionButton = hasActionButton
        self.onSelect = onSelect
        self.onHome = onHome
        _crownValue = State(initialValue: mode.crownValue)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    StatusPill(title: String(localized: "Ready"), color: accent)

                    Spacer(minLength: 4)

                    if let currentDepthMeters {
                        Text(DiveFormatters.depth(currentDepthMeters))
                            .font(DiveWatchTheme.metricFont(size: 13, weight: .semibold))
                            .foregroundStyle(DiveWatchTheme.mutedText)
                            .lineLimit(1)
                    }
                }

                HStack(spacing: 8) {
                    Image(systemName: systemImage)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(accent)

                    Text(mode.label)
                        .font(.system(size: 26, weight: .semibold, design: .rounded))
                        .foregroundStyle(DiveWatchTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)

                HStack(spacing: 6) {
                    modeButton(.freedive)
                    modeButton(.scuba)
                }

                Text(WetReadyStartGuidance.notRecordingText)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)

                Text("Rotate the Digital Crown to choose a mode.")
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.82))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)

                Text(startGuidance.text)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.mutedText)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.75)

                if startGuidance.showsHomeButton {
                    Button(String(localized: "Back to Home"), action: onHome)
                        .buttonStyle(DiveActionButtonStyle(kind: .secondary))
                }
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .focusable(true)
        .focused($crownFocused)
        .digitalCrownRotation(
            $crownValue,
            from: 0,
            through: 1,
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onAppear {
            crownFocused = true
        }
        .onChange(of: crownValue) { _, nextValue in
            let nextMode: DiveMode = nextValue < 0.5 ? .freedive : .scuba
            guard nextMode != mode else { return }
            onSelect(nextMode)
        }
        .onChange(of: mode) { _, nextMode in
            crownValue = nextMode.crownValue
            crownFocused = true
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var startGuidance: WetReadyStartGuidance {
        WetReadyStartGuidance(autoLaunchStatus: autoLaunchStatus, hasActionButton: hasActionButton)
    }

    private var accent: Color {
        mode == .freedive ? DiveWatchTheme.primary : DiveWatchTheme.secondary
    }

    private var systemImage: String {
        mode == .freedive ? "figure.pool.swim" : "drop.fill"
    }

    /// Touch works only before Water Lock is on, so the crown is the main way to choose.
    private func modeButton(_ candidate: DiveMode) -> some View {
        Button {
            onSelect(candidate)
        } label: {
            Text(candidate.label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(candidate == mode ? DiveWatchTheme.text : DiveWatchTheme.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    RoundedRectangle(cornerRadius: DiveWatchTheme.cardRadius, style: .continuous)
                        .fill(candidate == mode ? accent.opacity(0.28) : DiveWatchTheme.surfaceRaised)
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(candidate == mode ? .isSelected : [])
    }
}

private extension DiveMode {
    var crownValue: Double {
        self == .freedive ? 0 : 1
    }
}
