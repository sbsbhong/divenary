import {transformSync} from '@babel/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type MobileEnvironmentLoader = (options?: {
  environment?: NodeJS.ProcessEnv;
  babelEnvironment?: string;
  nodeEnvironment?: string;
  developmentEnvPath?: string;
  localEnvPath?: string;
}) => Record<string, string>;

const {loadMobileEnvironment} = require('../scripts/load-mobile-env') as {
  loadMobileEnvironment: MobileEnvironmentLoader;
};

const authIdentifiers = `
  export const authEnvironment = [
    __MOBILE_ENVIRONMENT_MODE__,
    __SUPABASE_URL__,
    __SUPABASE_PUBLISHABLE_KEY__,
    __GOOGLE_WEB_CLIENT_ID__,
    __GOOGLE_IOS_CLIENT_ID__,
    __SUPABASE_ANDROID_URL__,
    __LOCAL_AUTH_EMAIL__,
    __LOCAL_AUTH_PASSWORD__,
  ];
`;

function transform(source: string, envName: string) {
  return transformSync(source, {
    babelrc: false,
    configFile: path.resolve(__dirname, '../babel.config.js'),
    envName,
  })?.code ?? '';
}

describe('mobile Babel environment injection', () => {
  const originalEnvironment = {...process.env};

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
  });

  test('prefers process environment over development file values', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dive-mobile-env-'));
    const developmentEnvPath = path.join(directory, '.env.development');
    fs.writeFileSync(
      developmentEnvPath,
      'SUPABASE_URL=https://file.supabase.co\nSUPABASE_PUBLISHABLE_KEY=file-key\n',
      'utf8',
    );

    expect(
      loadMobileEnvironment({
        environment: {
          SUPABASE_URL: 'https://process.supabase.co',
          SUPABASE_PUBLISHABLE_KEY: 'process-key',
        },
        babelEnvironment: 'development',
        nodeEnvironment: 'development',
        developmentEnvPath,
      }),
    ).toMatchObject({
      SUPABASE_URL: 'https://process.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'process-key',
    });
  });

  test('loads ignored environment files only for development and test Babel environments', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dive-mobile-env-'));
    const developmentEnvPath = path.join(directory, '.env.development');
    fs.writeFileSync(
      developmentEnvPath,
      'SUPABASE_URL=https://file.supabase.co\nSUPABASE_PUBLISHABLE_KEY=file-key\n',
      'utf8',
    );

    expect(
      loadMobileEnvironment({
        environment: {},
        babelEnvironment: 'test',
        nodeEnvironment: 'test',
        developmentEnvPath,
      }).SUPABASE_URL,
    ).toBe('https://file.supabase.co');
    expect(
      loadMobileEnvironment({
        environment: {},
        babelEnvironment: 'production',
        nodeEnvironment: undefined,
        developmentEnvPath,
      }).SUPABASE_URL,
    ).toBeUndefined();
    expect(
      loadMobileEnvironment({
        environment: {},
        babelEnvironment: 'release-candidate',
        nodeEnvironment: 'development',
        developmentEnvPath,
      }).SUPABASE_URL,
    ).toBeUndefined();
  });

  test('selects the generated local file only for the explicit local mobile environment', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dive-mobile-env-'));
    const developmentEnvPath = path.join(directory, '.env.development');
    const localEnvPath = path.join(directory, '.env.local');
    fs.writeFileSync(developmentEnvPath, 'SUPABASE_URL=https://staging.supabase.co\n', 'utf8');
    fs.writeFileSync(localEnvPath, 'SUPABASE_URL=http://127.0.0.1:54321\n', 'utf8');

    const staging = loadMobileEnvironment({
        environment: {},
        babelEnvironment: 'development',
        nodeEnvironment: 'development',
        developmentEnvPath,
        localEnvPath,
      });
    expect(staging.SUPABASE_URL).toBe('https://staging.supabase.co');
    expect(staging.MOBILE_ENVIRONMENT_MODE).toBe('staging');

    const local = loadMobileEnvironment({
        environment: {MOBILE_ENVIRONMENT: 'local'},
        babelEnvironment: 'development',
        nodeEnvironment: 'development',
        developmentEnvPath,
        localEnvPath,
      });
    expect(local.SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(local.MOBILE_ENVIRONMENT_MODE).toBe('local');
  });

  test('rejects unknown explicit mobile environment selectors', () => {
    expect(() =>
      loadMobileEnvironment({
        environment: {MOBILE_ENVIRONMENT: 'locla'},
        babelEnvironment: 'development',
        nodeEnvironment: 'development',
      }),
    ).toThrow('MOBILE_ENVIRONMENT');
  });

  test('keeps an explicit release selector unconfigured in development', () => {
    const loaded = loadMobileEnvironment({
      environment: {
        MOBILE_ENVIRONMENT: 'release',
        SUPABASE_URL: 'https://release-sentinel.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'release-publishable-sentinel',
      },
      babelEnvironment: 'development',
      nodeEnvironment: 'development',
    });

    expect(loaded.MOBILE_ENVIRONMENT_MODE).toBe('release');
    expect(loaded).not.toHaveProperty('SUPABASE_URL');
    expect(loaded).not.toHaveProperty('SUPABASE_PUBLISHABLE_KEY');
  });

  test('keeps both development files out of production transforms', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dive-mobile-env-'));
    const developmentEnvPath = path.join(directory, '.env.development');
    const localEnvPath = path.join(directory, '.env.local');
    fs.writeFileSync(developmentEnvPath, 'SUPABASE_URL=https://staging.supabase.co\n', 'utf8');
    fs.writeFileSync(localEnvPath, 'SUPABASE_URL=http://127.0.0.1:54321\n', 'utf8');

    const release = loadMobileEnvironment({
        environment: {MOBILE_ENVIRONMENT: 'local'},
        babelEnvironment: 'production',
        nodeEnvironment: 'production',
        developmentEnvPath,
        localEnvPath,
      });

    expect(release.SUPABASE_URL).toBeUndefined();
    expect(release.MOBILE_ENVIRONMENT_MODE).toBe('release');
  });

  test('strips all Auth configuration from unknown and release process environments', () => {
    const syntheticEnvironment = {
      MOBILE_ENVIRONMENT: 'local',
      SUPABASE_URL: 'https://release-sentinel.supabase.co',
      SUPABASE_ANDROID_URL: 'http://10.0.2.2:54321',
      SUPABASE_PUBLISHABLE_KEY: 'release-publishable-sentinel',
      LOCAL_AUTH_EMAIL: 'release-email-sentinel@example.invalid',
      LOCAL_AUTH_PASSWORD: 'release-password-sentinel',
      GOOGLE_WEB_CLIENT_ID: 'release-google-web-sentinel',
      GOOGLE_IOS_CLIENT_ID: 'release-google-ios-sentinel',
    };

    for (const babelEnvironment of ['production', 'release-candidate']) {
      const loaded = loadMobileEnvironment({
        environment: syntheticEnvironment,
        babelEnvironment,
        nodeEnvironment: 'development',
      });

      expect(loaded.MOBILE_ENVIRONMENT_MODE).toBe('release');
      expect(loaded).not.toHaveProperty('SUPABASE_URL');
      expect(loaded).not.toHaveProperty('SUPABASE_ANDROID_URL');
      expect(loaded).not.toHaveProperty('SUPABASE_PUBLISHABLE_KEY');
      expect(loaded).not.toHaveProperty('LOCAL_AUTH_EMAIL');
      expect(loaded).not.toHaveProperty('LOCAL_AUTH_PASSWORD');
      expect(loaded).not.toHaveProperty('GOOGLE_WEB_CLIENT_ID');
      expect(loaded).not.toHaveProperty('GOOGLE_IOS_CLIENT_ID');
    }
  });

  test('inlines process values while leaving unknown identifiers untouched', () => {
    process.env.SUPABASE_URL = 'https://process.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'process-key';
    process.env.GOOGLE_WEB_CLIENT_ID = 'web-id';
    process.env.GOOGLE_IOS_CLIENT_ID = 'ios-id';
    process.env.SUPABASE_ANDROID_URL = 'http://10.0.2.2:54321';
    process.env.LOCAL_AUTH_EMAIL = 'divenary-local@development.invalid';
    process.env.LOCAL_AUTH_PASSWORD = 'test-password';
    process.env.MOBILE_ENVIRONMENT = 'local';

    const code = transform(
      `${authIdentifiers}\nexport const untouched = __UNKNOWN_IDENTIFIER__;`,
      'test',
    );

    expect(code).toContain('local');
    expect(code).toContain('https://process.supabase.co');
    expect(code).toContain('process-key');
    expect(code).toContain('web-id');
    expect(code).toContain('ios-id');
    expect(code).toContain('http://10.0.2.2:54321');
    expect(code).toContain('divenary-local@development.invalid');
    expect(code).toContain('test-password');
    expect(code).toContain('__UNKNOWN_IDENTIFIER__');
  });

  test('never treats Object prototype names as environment identifiers', () => {
    const code = transform(
      'export const preserved = toString;',
      'test',
    );

    expect(code).toContain('toString');
    expect(code).not.toContain('preserved=""');
  });

  test('production envName inlines empty strings without development fallback', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.GOOGLE_WEB_CLIENT_ID;
    delete process.env.GOOGLE_IOS_CLIENT_ID;
    delete process.env.SUPABASE_ANDROID_URL;
    delete process.env.LOCAL_AUTH_EMAIL;
    delete process.env.LOCAL_AUTH_PASSWORD;
    delete process.env.NODE_ENV;
    delete process.env.BABEL_ENV;

    const code = transform(authIdentifiers, 'production');
    expect(code).toContain('release');
    expect(code.match(/""/g)?.length).toBe(7);
  });

  test('production transforms do not inline local password credentials from the process environment', () => {
    process.env.LOCAL_AUTH_EMAIL = 'divenary-local@development.invalid';
    process.env.LOCAL_AUTH_PASSWORD = 'generated-password';
    process.env.NODE_ENV = 'production';

    process.env.SUPABASE_URL = 'https://release-sentinel.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'release-publishable-sentinel';
    process.env.GOOGLE_WEB_CLIENT_ID = 'release-google-web-sentinel';
    process.env.GOOGLE_IOS_CLIENT_ID = 'release-google-ios-sentinel';

    const code = transform(authIdentifiers, 'production');

    expect(code).not.toContain('divenary-local@development.invalid');
    expect(code).not.toContain('generated-password');
    expect(code).not.toContain('release-sentinel.supabase.co');
    expect(code).not.toContain('release-publishable-sentinel');
    expect(code).not.toContain('release-google-web-sentinel');
    expect(code).not.toContain('release-google-ios-sentinel');
  });

  test('does not replace local bindings or non-computed object keys', () => {
    process.env.SUPABASE_URL = 'https://global.supabase.co';
    const code = transform(
      `
        const __SUPABASE_URL__ = 'local-binding';
        export const local = __SUPABASE_URL__;
        export const object = { __SUPABASE_URL__: 1 };
      `,
      'test',
    );

    expect(code).toMatch(/__SUPABASE_URL__=['"]local-binding['"]/);
    expect(code).toMatch(/local=.*__SUPABASE_URL__/);
    expect(code).toMatch(/__SUPABASE_URL__:1/);
    expect(code).not.toContain('https://global.supabase.co');
  });

  test('loads the URL polyfill before every application import', () => {
    const indexSource = fs.readFileSync(
      path.resolve(__dirname, '../index.js'),
      'utf8',
    );
    const polyfillIndex = indexSource.indexOf(
      "import 'react-native-url-polyfill/auto';",
    );
    const reactNativeIndex = indexSource.indexOf(
      "import { AppRegistry } from 'react-native';",
    );

    expect(polyfillIndex).toBeGreaterThanOrEqual(0);
    expect(polyfillIndex).toBeLessThan(reactNativeIndex);
  });
});
