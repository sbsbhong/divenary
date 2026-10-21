export {};

const readRepoFile = (path: string): string => {
  const nodeRequire = require as (moduleName: string) => {
    readFileSync: (filePath: string, encoding: 'utf8') => string;
  };
  const fs = nodeRequire('fs');
  const cwd = (globalThis as unknown as {process: {cwd: () => string}})
    .process.cwd();

  return fs.readFileSync(`${cwd}/../../${path}`, 'utf8');
};

const readOptionalRepoFile = (path: string): string => {
  try {
    return readRepoFile(path);
  } catch {
    return '';
  }
};

const buildConfiguration = (project: string, id: string): string => {
  const start = project.indexOf(`\t\t${id} `);
  const end = project.indexOf('\n\t\t};', start);

  if (start < 0 || end < 0) {
    return '';
  }

  return project.slice(start, end + '\n\t\t};'.length);
};

const project = readRepoFile(
  'apps/mobile/ios/Divenary.xcodeproj/project.pbxproj',
);
const mobileInfoPlist = readRepoFile(
  'apps/mobile/ios/Divenary/Info.plist',
);
const watchInfoPlist = readRepoFile(
  'apps/mobile/ios/DivenaryWatchApp/Info.plist',
);
const mobileEntitlements = readOptionalRepoFile(
  'apps/mobile/ios/Divenary/Divenary.entitlements',
);
const watchEntitlements = readOptionalRepoFile(
  'apps/mobile/ios/DivenaryWatchApp/DivenaryWatchApp.entitlements',
);
const environmentExample = readRepoFile(
  'apps/mobile/.env.development.example',
);
const podfile = readRepoFile('apps/mobile/ios/Podfile');
const googleIosReversedClientId =
  'com.googleusercontent.apps.1011917902092-71ie1fvrcp3m4l9kb09g3nbvhofpjcd5';

const mobileConfigurations = [
  buildConfiguration(project, '13B07F941A680F5B00A75B9A'),
  buildConfiguration(project, '13B07F951A680F5B00A75B9A'),
];
const watchConfigurations = [
  buildConfiguration(project, 'D2388F5831CBB4A9A7F5AE22'),
  buildConfiguration(project, 'F85BD7A3A832F215EEE52819'),
];

describe('iOS social-auth native configuration', () => {
  test('assigns the Sign in with Apple entitlement to both iPhone configurations only', () => {
    for (const configuration of mobileConfigurations) {
      expect(configuration).toContain(
        'CODE_SIGN_ENTITLEMENTS = Divenary/Divenary.entitlements;',
      );
    }

    expect(mobileEntitlements).not.toBe('');
    expect(mobileEntitlements.match(/<key>[^<]+<\/key>/g)).toEqual([
      '<key>com.apple.developer.applesignin</key>',
    ]);
    expect(mobileEntitlements.match(/<string>[^<]+<\/string>/g)).toEqual([
      '<string>Default</string>',
    ]);

    for (const configuration of watchConfigurations) {
      expect(configuration).toContain(
        'CODE_SIGN_ENTITLEMENTS = DivenaryWatchApp/DivenaryWatchApp.entitlements;',
      );
      expect(configuration).not.toContain('Divenary/Divenary.entitlements');
    }

    expect(watchEntitlements.match(/<key>[^<]+<\/key>/g)).toEqual([
      '<key>com.apple.developer.submerged-shallow-depth-and-pressure</key>',
    ]);
    expect(watchEntitlements).not.toContain('com.apple.developer.applesignin');
  });

  test('keeps the Google reversed-client callback on the iPhone target only', () => {
    expect(mobileInfoPlist).toContain('<key>CFBundleURLTypes</key>');
    expect(mobileInfoPlist).toContain(
      '<string>$(GOOGLE_IOS_REVERSED_CLIENT_ID)</string>',
    );
    expect(watchInfoPlist).not.toContain('CFBundleURLTypes');
    expect(watchInfoPlist).not.toContain('GOOGLE_IOS_REVERSED_CLIENT_ID');

    for (const configuration of mobileConfigurations) {
      expect(configuration).toContain(
        `GOOGLE_IOS_REVERSED_CLIENT_ID = "${googleIosReversedClientId}";`,
      );
    }
    for (const configuration of watchConfigurations) {
      expect(configuration).not.toContain('GOOGLE_IOS_REVERSED_CLIENT_ID');
    }
  });

  test('enables module maps only for Google Sign-In transitive pods that need them', () => {
    expect(podfile).toContain(
      "pod 'GoogleUtilities', :modular_headers => true",
    );
    expect(podfile).toContain(
      "pod 'RecaptchaInterop', :modular_headers => true",
    );
    expect(podfile).not.toContain('use_modular_headers!');
  });

  test('documents only empty public app configuration in the development example', () => {
    expect(environmentExample).toMatch(/^SUPABASE_URL=$/m);
    expect(environmentExample).toMatch(/^SUPABASE_PUBLISHABLE_KEY=$/m);
    expect(environmentExample).toMatch(/^GOOGLE_WEB_CLIENT_ID=$/m);
    expect(environmentExample).toMatch(/^GOOGLE_IOS_CLIENT_ID=$/m);
    expect(environmentExample).toMatch(/^OPEN_METEO_API_KEY=$/m);
    expect(environmentExample).not.toContain('GOOGLE_IOS_REVERSED_CLIENT_ID');
    expect(environmentExample).not.toMatch(/SERVICE_ROLE|CLIENT_SECRET/);
  });
});
