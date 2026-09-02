import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const projectPath = join(root, 'ios/Divenary.xcodeproj/project.pbxproj');
const stringCatalogPath = join(root, 'ios/DivenaryWatchApp/Localizable.xcstrings');
const watchSourceFiles = [
  'ios/DivenaryWatchApp/Views/DepthGaugeRail.swift',
  'ios/DivenaryWatchApp/Views/DiveFormatters.swift',
  'ios/DivenaryWatchApp/Views/RecordingView.swift',
  'ios/DivenaryWatchApp/Views/SummaryView.swift',
  'ios/DivenaryWatchApp/Views/SessionDetailView.swift',
  'ios/DivenaryWatchApp/Views/SessionListView.swift',
  'ios/DivenaryWatchApp/Views/HomeView.swift',
  'ios/DivenaryWatchApp/Views/WetReadyView.swift',
  'ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift',
  'ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift',
];
const source = watchSourceFiles
  .map(file => readFileSync(join(root, file), 'utf8'))
  .join('\n');
const recordingViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/RecordingView.swift'),
  'utf8',
);
const wetReadyViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/WetReadyView.swift'),
  'utf8',
);
const summaryViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/SummaryView.swift'),
  'utf8',
);
const realRecordingFlowSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift'),
  'utf8',
);
const simulatedRecordingFlowSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift'),
  'utf8',
);
const homeViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/HomeView.swift'),
  'utf8',
);
const sessionListViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/SessionListView.swift'),
  'utf8',
);
const sessionDetailViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/SessionDetailView.swift'),
  'utf8',
);
const savedSessionSource = `${sessionListViewSource}\n${sessionDetailViewSource}`;
const project = readFileSync(projectPath, 'utf8');
const stringCatalogSource = existsSync(stringCatalogPath) ? readFileSync(stringCatalogPath, 'utf8') : '';
const stringCatalog = stringCatalogSource ? JSON.parse(stringCatalogSource) : undefined;
const stringCatalogEntries = Object.values(stringCatalog?.strings ?? {});
const bannedWatchCopy = [
  'safe to ascend',
  '상승 가능',
  '이제 안전합니다',
  '안전 확보',
  '감압 완료',
  'deco clear',
  'ceiling clear',
];
const copySource = `${source}\n${stringCatalogSource}`;
const bannedCopyMatches = bannedWatchCopy.filter(copy => copySource.toLowerCase().includes(copy.toLowerCase()));

const checks = [
  {
    name: 'watch surfaces avoid decorative card borders',
    pattern: /DiveWatchTheme\.outline|borderColor|\.stroke\(color\.opacity\(0\.65\)/,
  },
  {
    name: 'recording keeps one prominent live metric',
    pattern: /MetricCard\(\s*title:\s*"Bottom Time"[\s\S]*prominent:\s*true/,
  },
  {
    name: 'recording footer guidance stays readable at 9pt',
    failed: !/private func footerHint[\s\S]*\.font\(\.system\(size: 9, weight: \.medium\)\)/.test(
      recordingViewSource,
    ),
  },
  {
    name: 'saved-session disclaimer uses sentence-style copy',
    failed:
      !savedSessionSource.includes(
        'This app is a log review aid, not certified dive equipment.',
      ) || savedSessionSource.includes('LOG REVIEW ONLY. NON-CERTIFIED ASSISTANT.'),
  },
  {
    name: 'ascent copy stays reminder/review-only, not an instruction',
    pattern: /Slow down|Reduce ascent rate/,
  },
  {
    name: 'watch UI does not use success or warning as visual brand states',
    pattern: /DiveWatchTheme\.(success|warning)/,
  },
  {
    name: 'watch app declares Korean as a known localization region',
    failed: !/knownRegions = \([\s\S]*\bko\b[\s\S]*\);/.test(project),
  },
  {
    name: 'watch app includes Localizable.xcstrings in the Xcode project',
    failed: !/Localizable\.xcstrings/.test(project),
  },
  {
    name: 'wet ready uses crown selection without a crown-press confirmation',
    failed:
      !wetReadyViewSource.includes('.digitalCrownRotation(') ||
      /press.*Digital Crown/i.test(wetReadyViewSource),
  },
  {
    name: 'watch summary omits subjective post-dive input',
    pattern: /StarRatingControl|POST-DIVE REVIEW|TextField\("Quick note"/,
    source: summaryViewSource,
  },
  {
    name: 'real recording flow delegates persistence to the coordinator',
    failed:
      realRecordingFlowSource.includes('store.save(') ||
      realRecordingFlowSource.includes('onDiscard:'),
  },
  {
    name: 'demo completion reuses saved summary without save or discard controls',
    failed:
      !simulatedRecordingFlowSource.includes('SavedSessionSummaryView(') ||
      !simulatedRecordingFlowSource.includes('retryCompletedSessionSave') ||
      !simulatedRecordingFlowSource.includes('dismissSavedSummary') ||
      !simulatedRecordingFlowSource.includes('ToolbarItem(placement: .topBarLeading)') ||
      !simulatedRecordingFlowSource.includes('Image(systemName: "xmark")') ||
      !simulatedRecordingFlowSource.includes('endDive()') ||
      simulatedRecordingFlowSource.includes('CapturedSessionSummaryView') ||
      simulatedRecordingFlowSource.includes('saveSummary(') ||
      simulatedRecordingFlowSource.includes('discardSummary(') ||
      recordingViewSource.includes('case .demoButton') ||
      recordingViewSource.includes('Label("End Dive"') ||
      recordingViewSource.includes('Use the button to end the demo session.'),
  },
  {
    name: 'immediate-start cards use play affordances and concise labels',
    failed:
      !homeViewSource.includes('title: "Freediving"') ||
      !homeViewSource.includes('title: "Scuba Diving"') ||
      (homeViewSource.match(/trailingSystemImage: "play.fill"/g) ?? []).length !== 3 ||
      !homeViewSource.includes('static let minimumHeight: CGFloat = 64') ||
      homeViewSource.includes('subtitle: String(localized: "Crown-controlled sample dive")') ||
      homeViewSource.includes('Supplemental log · no safety calculation') ||
      homeViewSource.includes('Recommended safety stop reminder.'),
  },
  {
    name: 'real recording copy does not claim crown-press handling',
    failed: /press and hold the Digital Crown/i.test(recordingViewSource),
  },
  {
    name: 'saved real summary uses toolbar back navigation and a scroll footer',
    failed:
      !/struct SavedSessionSummaryView[\s\S]*ToolbarItem\(placement: \.topBarLeading\)[\s\S]*onBack/.test(summaryViewSource) ||
      /Button\("Done"/.test(
        summaryViewSource.slice(
          summaryViewSource.indexOf('struct SavedSessionSummaryView'),
          summaryViewSource.indexOf('struct CapturedSessionSummaryView'),
        ),
      ) ||
      !/struct SessionSummaryContent[\s\S]*DiveDisclaimer[\s\S]*if let footer[\s\S]*Text\(footer\)/.test(summaryViewSource),
  },
  {
    name: 'watch string catalog includes English and Korean localizations',
    failed:
      !stringCatalog ||
      stringCatalog.sourceLanguage !== 'en' ||
      stringCatalogEntries.length === 0 ||
      !stringCatalogEntries.every(entry => {
        const localizations = entry.localizations ?? {};
        return localizations.en?.stringUnit?.value && localizations.ko?.stringUnit?.value;
      }),
  },
  {
    name: `watch UI avoids banned safety copy${bannedCopyMatches.length > 0 ? `: ${bannedCopyMatches.join(', ')}` : ''}`,
    failed: bannedCopyMatches.length > 0,
  },
];

const failures = checks.filter(check =>
  check.failed ?? check.pattern.test(check.source ?? source),
);

if (failures.length > 0) {
  console.error('Watch UI language check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.name}`);
  }
  process.exit(1);
}
