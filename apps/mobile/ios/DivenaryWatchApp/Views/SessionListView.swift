import SwiftUI

struct SessionListView: View {
    @ObservedObject var store: DiveSessionStore

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if store.sessions.isEmpty {
                    EmptySessionsView()
                } else {
                    ForEach(store.sessions) { session in
                        NavigationLink {
                            SessionDetailView(store: store, savedSession: session)
                        } label: {
                            SessionRow(session: session)
                        }
                        .buttonStyle(.plain)
                    }
                }

                DiveDisclaimer(
                    text: String(localized: "This app is a log review aid, not certified dive equipment.")
                )
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Sessions")
    }
}

private struct EmptySessionsView: View {
    var body: some View {
        InstrumentCard(accent: DiveWatchTheme.secondary) {
            VStack(alignment: .leading, spacing: 7) {
                StatusPill(title: String(localized: "No logs"), color: DiveWatchTheme.secondary)
                Text("No saved sessions")
                    .font(DiveWatchTheme.metricFont(size: 20, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                Text("Start a recreational capture to create a watch log.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DiveWatchTheme.mutedText)
            }
        }
    }
}

private struct SessionRow: View {
    let session: DiveSessionRecord

    var body: some View {
        // The summary replays the depth profile, so it is computed once per render.
        let summary = session.summary
        let profileColor = Self.profileColor(maxDepthMeters: summary.maxDepthMeters)
        InstrumentCard {
            HStack(alignment: .center, spacing: 7) {
                DepthProfileSparkline(samples: session.samples, color: profileColor)
                    .frame(width: 44, height: 38)

                VStack(alignment: .leading, spacing: 4) {
                    Text(DiveFormatters.sessionDate.string(from: session.startedAt))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)

                    HStack(spacing: 5) {
                        SessionMetadataPill(title: session.diveMode.listBadgeLabel, color: profileColor)
                        if let captureProvenanceLabel = session.captureProvenanceLabel {
                            SessionMetadataPill(title: captureProvenanceLabel, color: DiveWatchTheme.secondary)
                        }
                        SessionSyncStatusPill(syncStatus: session.syncStatus)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)

                VStack(alignment: .trailing, spacing: 3) {
                    HStack(spacing: 2) {
                        if session.exceedsSupportedDepth {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(DiveWatchTheme.caution)
                                .accessibilityLabel(Text("Outside watch support"))
                        }
                        Text(DiveFormatters.depth(summary.maxDepthMeters))
                            .font(DiveWatchTheme.metricFont(size: 16, weight: .semibold))
                            .foregroundStyle(profileColor)
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    }
                    Text(DiveFormatters.duration(summary.durationSeconds))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DiveWatchTheme.mutedText)
                        .monospacedDigit()
                }
                .frame(width: 62, alignment: .trailing)
            }
        }
    }

    private static func profileColor(maxDepthMeters: Double) -> Color {
        if maxDepthMeters >= 20 {
            return DiveWatchTheme.primary
        }

        if maxDepthMeters >= 10 {
            return DiveWatchTheme.primary
        }

        return DiveWatchTheme.primary.opacity(0.78)
    }
}

private struct SessionMetadataPill: View {
    let title: String
    let color: Color

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 8, weight: .semibold))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(color.opacity(0.16))
            )
    }
}

private struct SessionSyncStatusPill: View {
    let syncStatus: DiveSyncStatus

    var body: some View {
        Text(syncStatus.shortLabel)
            .font(.system(size: 8, weight: .semibold))
            .foregroundStyle(syncStatus.tint)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .frame(minWidth: 42, minHeight: 16, alignment: .center)
            .background(
                Capsule()
                    .fill(syncStatus.tint.opacity(0.16))
            )
            .accessibilityLabel(syncStatus.label)
    }
}

private extension DiveMode {
    var listBadgeLabel: String {
        switch self {
        case .scuba:
            return String(localized: "SC")
        case .freedive:
            return String(localized: "FR")
        }
    }
}

private extension DiveSyncStatus {
    var shortLabel: String {
        switch self {
        case .pending:
            return String(localized: "Waiting")
        case .synced:
            return String(localized: "Synced")
        case .failed:
            return String(localized: "Failed")
        }
    }

    var tint: Color {
        switch self {
        case .pending:
            return DiveWatchTheme.secondary
        case .synced:
            return DiveWatchTheme.primary
        case .failed:
            return DiveWatchTheme.danger
        }
    }
}
