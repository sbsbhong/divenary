import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const projectPath = join(root, 'ios/Divenary.xcodeproj/project.pbxproj');
const stringCatalogPath = join(root, 'ios/DivenaryWatchApp/Localizable.xcstrings');
const watchSourceFiles = [
  'ios/DivenaryWatchApp/Views/DepthGaugeRail.swift',
  'ios/DivenaryWatchApp/Views/DiveFormatters.swift',
  'ios/DivenaryWatchApp/Views/RecordingView.swift',
  'ios/DivenaryWatchApp/Views/RecordingHint.swift',
  'ios/DivenaryWatchApp/Views/SummaryView.swift',
  'ios/DivenaryWatchApp/Views/SessionDetailView.swift',
  'ios/DivenaryWatchApp/Views/SessionListView.swift',
  'ios/DivenaryWatchApp/Views/HomeView.swift',
  'ios/DivenaryWatchApp/Views/WetReadyView.swift',
  'ios/DivenaryWatchApp/Views/RealRecordingFlowView.swift',
  'ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift',
  'ios/DivenaryWatchApp/Views/UnderwaterControlsView.swift',
];
const source = watchSourceFiles
  .map(file => readFileSync(join(root, file), 'utf8'))
  .join('\n');
const recordingViewSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/RecordingView.swift'),
  'utf8',
);
const recordingHintSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/RecordingHint.swift'),
  'utf8',
);
const underwaterControlsSource = readFileSync(
  join(root, 'ios/DivenaryWatchApp/Views/UnderwaterControlsView.swift'),
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
const blockOf = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  if (start < 0) {
    return '';
  }
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : -1;
  return end < 0 ? text.slice(start) : text.slice(start, end);
};
const recordingHintBarBlock = blockOf(recordingHintSource, 'struct RecordingHintBar', 'struct RecordingPageDots');
const realRecordingPagerBlock = blockOf(recordingHintSource, 'struct RealRecordingPager', 'struct RecordingHintBar');
const koreanCatalogValues = stringCatalogEntries
  .map(entry => entry.localizations?.ko?.stringUnit?.value ?? '')
  .join('\n');
// Shown copy only: stale entries are no longer in the source and never reach the screen.
const activeCatalogEntries = stringCatalogEntries.filter(entry => entry.extractionState !== 'stale');
const activeCatalogValues = language =>
  activeCatalogEntries.map(entry => entry.localizations?.[language]?.stringUnit?.value ?? '');
// One diver term per concept (동작 버튼, 수중 잠금, 디지털 크라운, 기록), and no internal words.
const koreanGlossaryLeaks = ['Action', 'Crown', '방수 잠금', '세션', '샘플', '캡처', 'Home'].filter(term =>
  activeCatalogValues('ko').some(value => value.includes(term)),
);
// 디지털 크라운 in sentences; 크라운 (optionally 앞으로/뒤로) only in short page chips.
const koreanCrownSpellingLeaks = activeCatalogValues('ko').filter(value =>
  value.replaceAll('디지털 크라운', '').replace(/^크라운(?: 앞으로| 뒤로)? ▸ /, '').includes('크라운'),
);
// The recommended stop is never a mandatory "safety stop", in shown or stale copy.
const englishCatalogValues = stringCatalogEntries
  .map(entry => entry.localizations?.en?.stringUnit?.value ?? '')
  .join('\n');
const safetyStopWordingLeaks = [
  ...(koreanCatalogValues.includes('세이프티') ? ['세이프티'] : []),
  ...(/safety stop/i.test(englishCatalogValues) ? ['safety stop'] : []),
];
const englishInternalWordLeaks = ['session', 'sample', 'capture'].filter(term =>
  activeCatalogValues('en').some(value => value.toLowerCase().includes(term)),
);

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
    name: 'real recording shows a one-line phase hint instead of a fixed end footer',
    failed:
      recordingViewSource.includes('End with the configured Action Button') ||
      recordingViewSource.includes('footerHint') ||
      !recordingViewSource.includes('if endControl == .crownHint, let hint') ||
      !recordingViewSource.includes('RecordingHintBar(hint: hint)') ||
      !recordingHintSource.includes('String(localized: "Action ▸ Details \\(position)/\\(pageCount)")') ||
      !recordingHintSource.includes('String(localized: "End available in \\(DiveFormatters.countdown(seconds: seconds))")') ||
      !recordingHintSource.includes('String(localized: "Action ▸ End page")') ||
      !recordingHintSource.includes('String(localized: "Press to end & save")') ||
      !recordingHintSource.includes('showsWaterLockNote: waterState == .notSubmerged') ||
      !recordingHintSource.includes('let input: Input = hasActionButton || page == .end ? .actionButton : .crown'),
  },
  {
    name: 'recording hint and paging have no tap target and the crown never ends a dive',
    failed:
      !recordingHintBarBlock ||
      !realRecordingPagerBlock ||
      recordingHintBarBlock.includes('Button(') ||
      realRecordingPagerBlock.includes('Button(') ||
      !realRecordingPagerBlock.includes('pages.stepFromCrown(by:') ||
      !realRecordingPagerBlock.includes('isHapticFeedbackEnabled: false') ||
      /requestActionButtonEnd|handleActionButtonPress/.test(realRecordingPagerBlock),
  },
  {
    name: 'watch UI uses the 300/400/600/700 weight ladder (no medium)',
    pattern: /weight: \.medium\b|\.fontWeight\(\.medium\)/,
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
      !simulatedRecordingFlowSource.includes('.safeAreaInset(edge: .bottom)') ||
      !simulatedRecordingFlowSource.includes('recordingMode == .demo') ||
      !simulatedRecordingFlowSource.includes('lifecycle.showsRecordingControls') ||
      !simulatedRecordingFlowSource.includes('Adjust depth with the Digital Crown') ||
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
      (homeViewSource.match(/trailingSystemImage: "play.fill"/g) ?? []).length !== 2 ||
      /StartSessionCard\(\s*title: "Demo"/.test(homeViewSource) ||
      !/HomeRow\(\s*title: "Demo"/.test(homeViewSource) ||
      !/HomeRow\(\s*title: "Underwater controls"/.test(homeViewSource) ||
      homeViewSource.includes('Ultra required') ||
      !homeViewSource.includes('static let minimumHeight: CGFloat = 64') ||
      !homeViewSource.includes('            .frame(minHeight: Self.minimumHeight)') ||
      homeViewSource.includes('subtitle: String(localized: "Crown-controlled sample dive")') ||
      homeViewSource.includes('Supplemental log · no safety calculation') ||
      homeViewSource.includes('Recommended safety stop reminder.'),
  },
  {
    name: 'real recording copy does not claim crown-press handling',
    failed: /press and hold the Digital Crown/i.test(
      `${recordingViewSource}\n${recordingHintSource}\n${underwaterControlsSource}`,
    ),
  },
  {
    name: 'Korean recommended stop copy uses 권장 스탑',
    failed: koreanCatalogValues.includes('스톱') || !koreanCatalogValues.includes('권장 스탑'),
  },
  {
    name: `recommended stop copy never says safety stop${safetyStopWordingLeaks.length > 0 ? `: ${safetyStopWordingLeaks.join(', ')}` : ''}`,
    failed: safetyStopWordingLeaks.length > 0,
  },
  {
    name: `Korean crown copy uses 디지털 크라운 (크라운 ▸ in chips)${koreanCrownSpellingLeaks.length > 0 ? `: ${koreanCrownSpellingLeaks.join(' | ')}` : ''}`,
    failed: koreanCrownSpellingLeaks.length > 0,
  },
  {
    name: `Korean watch copy keeps the diver glossary${koreanGlossaryLeaks.length > 0 ? `: ${koreanGlossaryLeaks.join(', ')}` : ''}`,
    failed: koreanGlossaryLeaks.length > 0,
  },
  {
    name: `English watch copy avoids internal words${englishInternalWordLeaks.length > 0 ? `: ${englishInternalWordLeaks.join(', ')}` : ''}`,
    failed: englishInternalWordLeaks.length > 0,
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
