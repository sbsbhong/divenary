import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const projectPath = join(root, 'ios/DiveMobile.xcodeproj/project.pbxproj');
const stringCatalogPath = join(root, 'ios/DiveWatchApp/Localizable.xcstrings');
const source = [
  'ios/DiveWatchApp/Views/DepthGaugeRail.swift',
  'ios/DiveWatchApp/Views/DiveFormatters.swift',
  'ios/DiveWatchApp/Views/RecordingView.swift',
  'ios/DiveWatchApp/Views/SummaryView.swift',
  'ios/DiveWatchApp/Views/SessionDetailView.swift',
  'ios/DiveWatchApp/Views/SessionListView.swift',
  'ios/DiveWatchApp/Views/HomeView.swift',
]
  .map(file => readFileSync(join(root, file), 'utf8'))
  .join('\n');
const project = readFileSync(projectPath, 'utf8');
const stringCatalogSource = existsSync(stringCatalogPath) ? readFileSync(stringCatalogPath, 'utf8') : '';
const stringCatalog = stringCatalogSource ? JSON.parse(stringCatalogSource) : undefined;
const stringCatalogEntries = Object.values(stringCatalog?.strings ?? {});

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
];

const failures = checks.filter(check => check.failed ?? check.pattern.test(source));

if (failures.length > 0) {
  console.error('Watch UI language check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.name}`);
  }
  process.exit(1);
}
