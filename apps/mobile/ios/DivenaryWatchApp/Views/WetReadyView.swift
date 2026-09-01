import SwiftUI

struct WetReadyView: View {
    let mode: DiveMode
    let currentDepthMeters: Double?
    let onSelect: (DiveMode) -> Void

    @State private var crownValue: Double
    @FocusState private var crownFocused: Bool

    init(
        mode: DiveMode,
        currentDepthMeters: Double?,
        onSelect: @escaping (DiveMode) -> Void
    ) {
        self.mode = mode
        self.currentDepthMeters = currentDepthMeters
        self.onSelect = onSelect
        _crownValue = State(initialValue: mode.crownValue)
    }

    var body: some View {
        VStack(spacing: 8) {
            StatusPill(title: String(localized: "Ready"), color: accent)

            Image(systemName: systemImage)
                .font(.system(size: 32, weight: .semibold))
                .foregroundStyle(accent)

            Text(mode.label)
                .font(DiveWatchTheme.metricFont(size: 28, weight: .semibold))
                .foregroundStyle(DiveWatchTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if let currentDepthMeters {
                Text(DiveFormatters.depth(currentDepthMeters))
                    .font(DiveWatchTheme.metricFont(size: 20, weight: .medium))
                    .foregroundStyle(DiveWatchTheme.primary)
                    .monospacedDigit()
            }

            Text("Underwater recording starts automatically.")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(DiveWatchTheme.mutedText)
                .multilineTextAlignment(.center)
                .lineLimit(2)

            HStack(spacing: 8) {
                modeButton(.freedive)
                modeButton(.scuba)
            }

            Text("Rotate the Digital Crown to choose a mode.")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(DiveWatchTheme.mutedText.opacity(0.76))
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .padding(.horizontal, DiveWatchTheme.edgeMargin)
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

    private var accent: Color {
        mode == .freedive ? DiveWatchTheme.primary : DiveWatchTheme.secondary
    }

    private var systemImage: String {
        mode == .freedive ? "figure.pool.swim" : "drop.fill"
    }

    private func modeButton(_ candidate: DiveMode) -> some View {
        Button {
            onSelect(candidate)
        } label: {
            Text(candidate.label)
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 30)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(candidate == mode ? accent.opacity(0.28) : DiveWatchTheme.surfaceRaised)
                )
        }
        .buttonStyle(.plain)
    }
}

private extension DiveMode {
    var crownValue: Double {
        self == .freedive ? 0 : 1
    }
}
