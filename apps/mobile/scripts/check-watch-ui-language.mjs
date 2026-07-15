import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const projectPath = join(root, 'ios/Divenary.xcodeproj/project.pbxproj');
const stringCatalogPath = join(root, 'ios/DivenaryWatchApp/Localizable.xcstrings');
const source = [
  'ios/DivenaryWatchApp/Views/DepthGaugeRail.swift',
  'ios/DivenaryWatchApp/Views/DiveFormatters.swift',
  'ios/DivenaryWatchApp/Views/RecordingView.swift',
  'ios/DivenaryWatchApp/Views/SummaryView.swift',
  'ios/DivenaryWatchApp/Views/SessionDetailView.swift',
  'ios/DivenaryWatchApp/Views/SessionListView.swift',
  'ios/DivenaryWatchApp/Views/HomeView.swift',
]
  .map(file => readFileSync(join(root, file), 'utf8'))
  .join('\n');
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

const failures = checks.filter(check => check.failed ?? check.pattern.test(source));

if (failures.length > 0) {
  console.error('Watch UI language check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.name}`);
  }
  process.exit(1);
}
