import SwiftUI

/// How to control Divenary once the touchscreen is locked underwater. watchOS reports the
/// auto-launch status; no public API says whether Divenary is assigned to the Action Button, so
/// that part is a how-to with conditional wording.
struct UnderwaterControlsView: View {
    let autoLaunchStatus: DepthAutoLaunchStatus
    let hasActionButton: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                GuideSection(title: String(localized: "Auto-Launch"), status: autoLaunchStatus.displayText) {
                    GuideText(String(localized: "In Settings > General > Auto-Launch, choose Divenary for When Submerged. Recording then starts when watchOS starts the dive session."))
                }

                GuideSection(title: String(localized: "Action Button")) {
                    if hasActionButton {
                        GuideText(String(localized: "In Settings > Action Button, choose Dive, then Divenary."))
                        GuideText(String(localized: "If you assigned Divenary to the Action Button, the first press starts a dive and later presses switch pages. At the surface after 3 minutes, a press on the last page ends and saves."))
                        GuideText(String(localized: "Before you dive, press the Action Button on the Switch type page to change between scuba and freediving."))
                    } else {
                        GuideText(String(localized: "This watch may not have an Action Button. Start from Home before entering the water."))
                    }
                }

                GuideSection(title: String(localized: "Digital Crown")) {
                    if hasActionButton {
                        GuideText(String(localized: "While recording, turn the Digital Crown to move between pages. Switching type and ending still take an Action Button press."))
                    } else {
                        GuideText(String(localized: "While recording, turn the Digital Crown to switch between Live and Details."))
                    }
                    GuideText(String(localized: "Turning off Water Lock at the surface ends recording."))
                }

                DiveDisclaimer()
            }
            .padding(.horizontal, DiveWatchTheme.edgeMargin)
            .padding(.vertical, 10)
        }
        .background(DiveWatchTheme.background.ignoresSafeArea())
        .navigationTitle("Underwater controls")
    }
}

private struct GuideSection<Content: View>: View {
    let title: String
    var status: String?
    @ViewBuilder let content: Content

    var body: some View {
        InstrumentCard {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DiveWatchTheme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                if let status {
                    StatusPill(title: status, color: DiveWatchTheme.secondary)
                }

                content
            }
        }
    }
}

private struct GuideText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .regular))
            .foregroundStyle(DiveWatchTheme.mutedText)
            .fixedSize(horizontal: false, vertical: true)
    }
}

#if DEBUG
#Preview("Underwater Controls") {
    NavigationStack {
        UnderwaterControlsView(autoLaunchStatus: .inactive, hasActionButton: true)
    }
}
#endif
