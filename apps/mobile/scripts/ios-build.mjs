import { readFileSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const workspacePath = 'ios/Divenary.xcworkspace';
const workspaceDataPath = `${workspacePath}/contents.xcworkspacedata`;
const requiredPodArtifacts = [
  'ios/Pods/Target Support Files/Pods-Divenary/Pods-Divenary.debug.xcconfig',
  'ios/Pods/Target Support Files/Pods-Divenary/Pods-Divenary.release.xcconfig',
  'ios/Pods/Headers/Public/ReactAppDependencyProvider/ReactAppDependencyProvider.modulemap',
  'ios/Pods/Headers/Public/ReactCodegen/ReactCodegen.modulemap',
  'ios/Pods/React-Core-prebuilt/React-VFS.yaml',
  'ios/build/generated/ios/ReactAppDependencyProvider/RCTAppDependencyProvider.h',
  'ios/build/generated/ios/ReactCodegen/RCTThirdPartyComponentsProvider.h',
];

const hasDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const hasFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const workspaceReferencesPods = () => {
  if (!hasFile(workspaceDataPath)) {
    return false;
  }

  const workspaceData = readFileSync(workspaceDataPath, 'utf8');
  return (
    workspaceData.includes('Divenary.xcodeproj') &&
    workspaceData.includes('Pods/Pods.xcodeproj')
  );
};

const commandExists = (command, args = ['--version']) => {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  return result.status ?? 1;
};

const getPodsIssue = () => {
  if (!hasDirectory(workspacePath)) {
    return `${workspacePath} is missing`;
  }

  if (!workspaceReferencesPods()) {
    return `${workspaceDataPath} does not reference the app and Pods projects`;
  }

  const missingArtifact = requiredPodArtifacts.find((path) => !hasFile(path));
  if (missingArtifact) {
    return `${missingArtifact} is missing`;
  }

  return null;
};

const installPods = () => {
  if (!commandExists('bundle')) {
    console.error(
      'ios:build unavailable: Bundler is missing. Install Ruby Bundler, then run `bundle install` from apps/mobile.',
    );
    return 1;
  }

  if (!commandExists('cmake')) {
    console.error(
      'ios:build unavailable: CMake is required by React Native Hermes pods. Install it, for example `brew install cmake`, then retry.',
    );
    return 1;
  }

  const bundleCheckStatus = run('bundle', ['check']);
  if (bundleCheckStatus !== 0) {
    console.error(
      'ios:build unavailable: Ruby gems are missing. Run `bundle install` from apps/mobile, then retry.',
    );
    return bundleCheckStatus;
  }

  console.log('ios:build preparing CocoaPods workspace...');
  return run('bundle', ['exec', 'pod', 'install'], {
    cwd: 'ios',
  });
};

const podsIssue = getPodsIssue();
if (podsIssue) {
  console.log(`ios:build found incomplete CocoaPods setup: ${podsIssue}`);
  const podInstallStatus = installPods();

  if (podInstallStatus !== 0) {
    process.exit(podInstallStatus);
  }
}

const remainingPodsIssue = getPodsIssue();
if (remainingPodsIssue) {
  console.error(
    `ios:build unavailable: CocoaPods workspace is incomplete (${remainingPodsIssue}). Run \`yarn workspace @repo/mobile ios:pods\`, then retry.`,
  );
  process.exit(1);
}

const args = [
  '-workspace',
  workspacePath,
  '-scheme',
  'Divenary',
  '-configuration',
  'Debug',
  '-destination',
  'generic/platform=iOS Simulator',
  '-derivedDataPath',
  '/private/tmp/DivenaryDerivedData',
  'CODE_SIGNING_ALLOWED=NO',
  'RCT_NO_LAUNCH_PACKAGER=1',
  'build',
];

const child = spawn('xcodebuild', args, { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
