import SwiftUI

/// The saved logs (spec F #34–#36): one platter row per log, newest first. A first read that fails
/// shows what happened and "다시 시도" (COPY C10); an empty list shows the Divenary logo. The
/// non-certified sentence closes the list.
struct SessionListView: View {
    @ObservedObject var store: DiveSessionStore

    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        ScrollView {
            LazyVStack(spacing: DiveSpacing.rowGap) {
                if store.historyReadState == .failed {
                    SessionReadFailure(onRetry: store.retryLoadingHistory)
                }
                if store.sessions.isEmpty && store.historyReadState == .loaded {
                    EmptySessionsView()
                } else {
                    // A failed first read has no rows; logs read before a later failure stay listed.
                    ForEach(store.sessions) { session in
                        NavigationLink {
                            SessionDetailView(store: store, savedSession: session)
                        } label: {
                            SessionRow(session: session)
                        }
                        .buttonStyle(DivePressStyle())
                        .diveScrollEdge()
                    }
                }

                DiveDisclaimer(
                    text: String(localized: "This app is a log review aid, not certified dive equipment.")
                )
                .padding(.top, DiveSpacing.groupGap(sizeClass))
                .padding(.horizontal, PostDiveLayout.textGutter(sizeClass) - DiveLayout.platterInset(sizeClass))
            }
            .padding(.horizontal, DiveLayout.platterInset(sizeClass))
            .padding(.bottom, 8)
        }
        // Platter insets are measured from the screen's edges (spec B3).
        .ignoresSafeArea(.container, edges: .horizontal)
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .environment(\.diveType, sizeClass.postDiveType)
        .navigationTitle("Sessions")
    }
}

/// The saved logs could not be read (spec F #35, COPY C10): the message on a platter, then the
/// retry as its own capsule outside it.
private struct SessionReadFailure: View {
    let onRetry: () -> Void

    private let sizeClass = DiveType.SizeClass.current

    var body: some View {
        VStack(spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(DiveWatchTheme.danger)
                Text(String(localized: "Could not read saved records."))
                    .foregroundStyle(DiveWatchTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .diveFont(.body)
            .padding(.horizontal, DiveLayout.platterPadding(sizeClass))
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DiveRadius.row, style: .continuous)
                    .fill(DiveWatchTheme.platter)
            )
            .accessibilityElement(children: .combine)

            Button(String(localized: "Retry"), action: onRetry)
                .buttonStyle(DiveActionButtonStyle(kind: .secondary))
        }
    }
}

/// No saved logs yet (spec F #36): the Divenary logo in grey, then what to do (D16).
private struct EmptySessionsView: View {
    var body: some View {
        VStack(spacing: 4) {
            LogoMark()
                .fill(DiveWatchTheme.ink3, style: LogoMark.fillStyle)
                .aspectRatio(LogoMark.aspectRatio, contentMode: .fit)
                .frame(width: PostDiveLayout.emptyListLogoWidth)
                .padding(.bottom, 8)
                .accessibilityHidden(true)
            Text(String(localized: "No logs"))
                .diveFont(.eyebrow)
                .foregroundStyle(DiveWatchTheme.ink2)
            Text("No saved sessions")
                .diveFont(.headline)
                .foregroundStyle(DiveWatchTheme.ink)
            Text("Start a recreational capture to create a watch log.")
                .diveFont(.footnote)
                .foregroundStyle(DiveWatchTheme.ink2)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity)
        .padding(.top, 16)
        .accessibilityElement(children: .combine)
    }
}

/// One saved log (spec F #34): the date with the sync glyph, the maximum depth and dive time, the
/// profile, then the dive type in plain grey with any markers (D3, D4). VoiceOver reads one summary.
private struct SessionRow: View {
    let session: DiveSessionRecord
    /// The summary replays the depth profile, so it is computed once per view value.
    private let summary: DiveSessionSummary
    private let profilePoints: [CGPoint]

    private let sizeClass = DiveType.SizeClass.current

    init(session: DiveSessionRecord) {
        self.session = session
        summary = session.summary
        profilePoints = MiniDepthProfile.normalizedPoints(
            depths: MiniDepthProfile.thinnedDepths(session.samples.map(\.depthMeters), maximumCount: 90)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            // The date keeps the row's width and wraps at larger text sizes; the glyph rides its first line.
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(DiveFormatters.relativeDate(session.startedAt))
                    .diveFont(.cardDate)
                    .foregroundStyle(DiveWatchTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                SessionSyncStatusPill(syncStatus: session.syncStatus)
            }

            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(DiveFormatters.depthValue(summary.maxDepthMeters))
                    .diveFont(.listDepth)
                    .foregroundStyle(DiveWatchTheme.ink)
                Text(verbatim: "m")
                    .diveFont(.unitM)
                    .foregroundStyle(DiveWatchTheme.ink2)
                    .padding(.leading, 2)
                Text(verbatim: "· \(DiveFormatters.cardDuration(summary.durationSeconds))")
                    .diveFont(.cardDetail)
                    .foregroundStyle(DiveWatchTheme.ink2)
                    .padding(.leading, 5)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)

            if !profilePoints.isEmpty {
                DepthSparkline(id: session.id, points: profilePoints)
                    .frame(height: PostDiveLayout.listProfileHeight(sizeClass))
                    .padding(.vertical, 3)
            }

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) { details(keepsOneLine: true) }
                VStack(alignment: .leading, spacing: 3) { details(keepsOneLine: false) }
            }
        }
        .padding(.horizontal, DiveLayout.platterPadding(sizeClass))
        .padding(.top, 9)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DiveRadius.row, style: .continuous)
                .fill(DiveWatchTheme.platter)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DiveFormatters.sessionAccessibilitySummary(session, summary: summary))
    }

    /// The type as plain words, never a chip (D4), then the Demo/Test marker and the other markers.
    @ViewBuilder
    private func details(keepsOneLine: Bool) -> some View {
        Text(session.diveMode.label)
            .diveFont(.cardDetail)
            .foregroundStyle(DiveWatchTheme.ink2)
            .fixedSize(horizontal: keepsOneLine, vertical: true)
        if let captureProvenanceLabel = session.captureProvenanceLabel {
            MarkerChip(title: captureProvenanceLabel)
                .fixedSize()
        }
        if session.exceedsSupportedDepth {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(DiveWatchTheme.caution)
                Text(String(localized: "Outside watch support"))
                    .foregroundStyle(DiveWatchTheme.ink2)
            }
            .diveFont(.cardMarker)
            .fixedSize(horizontal: keepsOneLine, vertical: true)
        }
        if let recoveryLabel = session.recoveryLabel {
            Text(recoveryLabel)
                .diveFont(.cardMarker)
                .foregroundStyle(DiveWatchTheme.ink2)
                .fixedSize(horizontal: keepsOneLine, vertical: true)
        }
    }
}

private struct SessionSyncStatusPill: View {
    let syncStatus: DiveSyncStatus

    var body: some View {
        Image(systemName: syncStatus.symbol)
            .diveFont(.cardMarker)
            .foregroundStyle(syncStatus.tint)
            .contentTransition(.symbolEffect(.replace))
            .fixedSize()
            .accessibilityLabel(syncStatus.label)
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
