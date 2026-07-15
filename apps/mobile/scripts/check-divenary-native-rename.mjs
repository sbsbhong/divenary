import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

const readText = (path) => readFileSync(join(root, path), 'utf8');
const exists = (path) => existsSync(join(root, path));
const addFailure = (message) => failures.push(message);
const expectPath = (path) => {
  if (!exists(path)) {
    addFailure(`${path} is missing`);
  }
};
const hasOnlyXcodeUserData = (path) => {
  const absolutePath = join(root, path);
  if (!existsSync(absolutePath)) {
    return true;
  }

  const visit = (currentPath, relativeParts) => {
    const stat = statSync(currentPath);
    if (stat.isFile()) {
      return relativeParts.includes('xcuserdata');
    }
    if (!stat.isDirectory()) {
      return false;
    }

    const entries = readdirSync(currentPath);
    return entries.every((entry) => visit(join(currentPath, entry), [...relativeParts, entry]));
  };

  return visit(absolutePath, path.split('/'));
};
const expectNoSourcePath = (path) => {
  if (exists(path) && !hasOnlyXcodeUserData(path)) {
    addFailure(`${path} should be renamed`);
  }
};
const expectIncludes = (source, value, label) => {
  if (!source.includes(value)) {
    addFailure(`${label} should include ${value}`);
  }
};
const expectExcludes = (source, value, label) => {
  if (source.includes(value)) {
    addFailure(`${label} should not include ${value}`);
  }
};

const expectedPaths = [
  'app.json',
  'ios/Divenary.xcodeproj/project.pbxproj',
  'ios/Divenary.xcworkspace/contents.xcworkspacedata',
  'ios/Divenary/Info.plist',
  'ios/Divenary/Divenary.entitlements',
  'ios/DivenaryWatchApp/Info.plist',
  'ios/DivenaryWatchAppTests',
  'ios/Divenary.xcodeproj/xcshareddata/xcschemes/Divenary.xcscheme',
  'ios/Divenary.xcodeproj/xcshareddata/xcschemes/DivenaryWatchApp.xcscheme',
  'ios/Divenary.xcodeproj/xcshareddata/xcschemes/DivenaryWatchAppDebug.xcscheme',
  'ios/Divenary.xcodeproj/xcshareddata/xcschemes/DivenaryWatchAppTests.xcscheme',
];

const obsoletePaths = [
  'ios/DiveMobile.xcodeproj',
  'ios/DiveMobile.xcworkspace',
  'ios/DiveMobile',
  'ios/DiveWatchApp',
  'ios/DiveWatchAppTests',
];

for (const path of expectedPaths) {
  expectPath(path);
}

for (const path of obsoletePaths) {
  expectNoSourcePath(path);
}

if (exists('app.json')) {
  const appJson = JSON.parse(readText('app.json'));
  if (appJson.name !== 'Divenary') {
    addFailure(`app.json name should be Divenary, found ${appJson.name}`);
  }
  if (appJson.displayName !== 'Divenary') {
    addFailure(`app.json displayName should be Divenary, found ${appJson.displayName}`);
  }
}

const projectPath = 'ios/Divenary.xcodeproj/project.pbxproj';
if (exists(projectPath)) {
  const project = readText(projectPath);
  const requiredProjectValues = [
    'Divenary.app',
    'DivenaryWatchApp.app',
    'DivenaryWatchAppTests.xctest',
    'PRODUCT_BUNDLE_IDENTIFIER = com.divenary.app;',
    'PRODUCT_BUNDLE_IDENTIFIER = com.divenary.app.watchkitapp;',
    'PRODUCT_BUNDLE_IDENTIFIER = com.divenary.app.watchkitapp.tests;',
    'INFOPLIST_FILE = Divenary/Info.plist;',
    'INFOPLIST_FILE = DivenaryWatchApp/Info.plist;',
    'CODE_SIGN_ENTITLEMENTS = Divenary/Divenary.entitlements;',
  ];

  for (const value of requiredProjectValues) {
    expectIncludes(project, value, projectPath);
  }

  for (const value of [
    'DiveMobile.app',
    'DiveWatchApp.app',
    'DiveWatchAppTests.xctest',
    'org.reactjs.native.example.DiveMobile',
    'org.reactjs.native.example.DiveWatchApp',
  ]) {
    expectExcludes(project, value, projectPath);
  }
}

if (exists('ios/Divenary/Info.plist')) {
  const info = readText('ios/Divenary/Info.plist');
  expectIncludes(info, '<string>Divenary</string>', 'ios/Divenary/Info.plist');
  expectIncludes(
    info,
    '<string>Divenary uses your current location to show local weather, air temperature, and water temperature context.</string>',
    'ios/Divenary/Info.plist',
  );
  expectExcludes(info, 'DiveMobile', 'ios/Divenary/Info.plist');
}

if (exists('ios/DivenaryWatchApp/Info.plist')) {
  const info = readText('ios/DivenaryWatchApp/Info.plist');
  expectIncludes(info, '<string>Divenary</string>', 'ios/DivenaryWatchApp/Info.plist');
  expectIncludes(info, '<string>com.divenary.app</string>', 'ios/DivenaryWatchApp/Info.plist');
  expectExcludes(info, 'Dive Watch', 'ios/DivenaryWatchApp/Info.plist');
  expectExcludes(info, 'DiveMobile', 'ios/DivenaryWatchApp/Info.plist');
}

if (exists('ios/Podfile')) {
  const podfile = readText('ios/Podfile');
  expectIncludes(podfile, "target 'Divenary' do", 'ios/Podfile');
  expectExcludes(podfile, "target 'DiveMobile' do", 'ios/Podfile');
}

if (exists('ios/Divenary.xcworkspace/contents.xcworkspacedata')) {
  const workspace = readText('ios/Divenary.xcworkspace/contents.xcworkspacedata');
  expectIncludes(workspace, 'Divenary.xcodeproj', 'ios/Divenary.xcworkspace/contents.xcworkspacedata');
  expectExcludes(workspace, 'DiveMobile.xcodeproj', 'ios/Divenary.xcworkspace/contents.xcworkspacedata');
}

for (const scheme of [
  'Divenary',
  'DivenaryWatchApp',
  'DivenaryWatchAppDebug',
  'DivenaryWatchAppTests',
]) {
  const path = `ios/Divenary.xcodeproj/xcshareddata/xcschemes/${scheme}.xcscheme`;
  if (exists(path)) {
    const source = readText(path);
    const buildableName = scheme === 'DivenaryWatchAppTests'
      ? 'DivenaryWatchAppTests.xctest'
      : `${scheme.replace('Debug', '')}.app`;
    expectIncludes(source, `BuildableName = "${buildableName}"`, path);
    expectExcludes(source, 'DiveMobile', path);
    expectExcludes(source, 'DiveWatchApp', path);
  }
}

if (failures.length > 0) {
  console.error('Divenary native rename check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Divenary native rename check passed.');
