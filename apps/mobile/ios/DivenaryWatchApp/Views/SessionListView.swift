import SwiftUI

struct SessionListView: View {
    @ObservedObject var store: DiveSessionStore

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if store.historyReadState == .failed {
                    InstrumentCard(accent: DiveWatchTheme.secondary) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(String(localized: "Could not read saved records."))
                                .font(.body)
                                .foregroundStyle(DiveWatchTheme.text)
                            Button(String(localized: "Retry")) { store.retryLoadingHistory() }
                                .buttonStyle(DiveActionButtonStyle(kind: .secondary))
                        }
                    }
                }
                if store.sessions.isEmpty && store.historyReadState == .loaded {
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
                    .font(.title3)
                    .foregroundStyle(DiveWatchTheme.text)
                Text("Start a recreational capture to create a watch log.")
                    .font(.body)
                    .foregroundStyle(DiveWatchTheme.mutedText)
            }
        }
    }
}

private struct SessionRow: View {
    let session: DiveSessionRecord

    var body: some View {
        let summary = session.summary
        InstrumentCard {
            VStack(alignment: .leading, spacing: 7) {
                // The date owns the entire row width and can wrap at larger text sizes.
                Text(DiveFormatters.sessionDate.string(from: session.startedAt))
                    .font(.system(.caption, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .fixedSize(horizontal: false, vertical: true)

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { metrics(summary) }
                    VStack(alignment: .leading, spacing: 3) { metrics(summary) }
                }
                .font(.system(.body, design: .rounded, weight: .semibold).monospacedDigit())

                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 5) { badges }
                    VStack(alignment: .leading, spacing: 4) { badges }
                }
                if let recoveryLabel = session.recoveryLabel {
                    Text(recoveryLabel)
                        .font(.caption2)
                        .foregroundStyle(DiveWatchTheme.secondary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DiveFormatters.sessionAccessibilitySummary(session, summary: summary))
    }

    @ViewBuilder
    private func metrics(_ summary: DiveSessionSummary) -> some View {
        Text(DiveFormatters.depth(summary.maxDepthMeters))
            .foregroundStyle(DiveWatchTheme.text)
        Text(DiveFormatters.duration(summary.durationSeconds))
            .foregroundStyle(DiveWatchTheme.mutedText)
    }

    @ViewBuilder
    private var badges: some View {
        SessionMetadataPill(title: session.diveMode.listBadgeLabel, color: DiveWatchTheme.secondary)
        if let captureProvenanceLabel = session.captureProvenanceLabel {
            SessionMetadataPill(title: captureProvenanceLabel, color: DiveWatchTheme.secondary)
        }
        SessionSyncStatusPill(syncStatus: session.syncStatus)
        if session.exceedsSupportedDepth {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DiveWatchTheme.caution)
                .accessibilityLabel(String(localized: "Outside watch support"))
        }
    }
}

private struct SessionMetadataPill: View {
    let title: String
    let color: Color

    var body: some View {
        Text(title)
            .font(.system(.caption2, weight: .semibold))
            .foregroundStyle(color)
            .fixedSize()
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .background(Capsule().fill(color.opacity(0.16)))
    }
}

private struct SessionSyncStatusPill: View {
    let syncStatus: DiveSyncStatus

    var body: some View {
        Image(systemName: syncStatus.symbol)
            .font(.system(.caption, weight: .semibold))
            .foregroundStyle(syncStatus.tint)
            .fixedSize()
            .accessibilityLabel(syncStatus.label)
    }
}

extension DiveMode {
    var listBadgeLabel: String {
        switch self {
        case .scuba:
            return String(localized: "SC")
        case .freedive:
            return String(localized: "FR")
        }
    }
}

/// The sync glyph for narrow rows: the saved list and the latest log card on Home show the glyph
/// only, and VoiceOver reads the full `label` (DECISIONS D3). It says what happens: the log is on its
/// way from the watch, saved on iPhone, or not sent to iPhone.
extension DiveSyncStatus {
    var symbol: String {
        switch self {
        case .pending: return "applewatch.and.arrow.forward"
        case .synced: return "iphone.gen3"
        case .failed: return "iphone.gen3.slash"
        }
    }

    /// Grey, apart from a failed send. Blue stays for actions and selection.
    var tint: Color {
        switch self {
        case .pending, .synced:
            return DiveWatchTheme.ink2
        case .failed:
            return DiveWatchTheme.danger
        }
    }
}
