import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type MobileEnvironmentModule = {
  createMobileEnvironmentCacheVersion(
    environment: Record<string, string>,
  ): string;
  loadMobileEnvironment(options?: {
    environment?: NodeJS.ProcessEnv;
    babelEnvironment?: string;
    nodeEnvironment?: string;
    developmentEnvPath?: string;
    localEnvPath?: string;
  }): Record<string, string>;
};

const mobileEnvironment = require('../scripts/load-mobile-env') as MobileEnvironmentModule;
const {createMetroEnvironmentConfig} = require('../scripts/create-metro-environment-config') as {
  createMetroEnvironmentConfig(options?: {
    environment?: NodeJS.ProcessEnv;
    babelEnvironment?: string;
    nodeEnvironment?: string;
    developmentEnvPath?: string;
    localEnvPath?: string;
  }): {cacheVersion: string};
};
const originalEnvironment = {...process.env};

function restoreProcessEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnvironment);
}

describe('Metro mobile environment cache identity', () => {
  afterEach(() => {
    restoreProcessEnvironment();
    jest.resetModules();
  });

  test('changes after local password rotation without containing the password', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dive-metro-env-'));
    const localEnvPath = path.join(directory, '.env.local');
    const loadLocal = () =>
      mobileEnvironment.loadMobileEnvironment({
        environment: {MOBILE_ENVIRONMENT: 'local'},
        babelEnvironment: 'development',
        nodeEnvironment: 'development',
        localEnvPath,
      });

    fs.writeFileSync(
      localEnvPath,
      'SUPABASE_URL=http://127.0.0.1:54321\nLOCAL_AUTH_PASSWORD=rotation-password-a\n',
      'utf8',
    );
    const first = mobileEnvironment.createMobileEnvironmentCacheVersion(
      loadLocal(),
    );

    fs.writeFileSync(
      localEnvPath,
      'SUPABASE_URL=http://127.0.0.1:54321\nLOCAL_AUTH_PASSWORD=rotation-password-b\n',
      'utf8',
    );
    const second = mobileEnvironment.createMobileEnvironmentCacheVersion(
      loadLocal(),
    );

    expect(first).toMatch(/^mobile-environment-v1-[a-f0-9]{64}$/);
    expect(second).toMatch(/^mobile-environment-v1-[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(first).not.toContain('rotation-password-a');
    expect(second).not.toContain('rotation-password-b');
  });

  test('separates staging and local modes even when inline values match', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dive-metro-env-'));
    const developmentEnvPath = path.join(directory, '.env.development');
    const localEnvPath = path.join(directory, '.env.local');
    const shared =
      'SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_PUBLISHABLE_KEY=synthetic-key\n';
    fs.writeFileSync(developmentEnvPath, shared, 'utf8');
    fs.writeFileSync(localEnvPath, shared, 'utf8');

    const staging = mobileEnvironment.loadMobileEnvironment({
      environment: {},
      babelEnvironment: 'test',
      developmentEnvPath,
      localEnvPath,
    });
    const local = mobileEnvironment.loadMobileEnvironment({
      environment: {MOBILE_ENVIRONMENT: 'local'},
      babelEnvironment: 'test',
      developmentEnvPath,
      localEnvPath,
    });

    expect(
      mobileEnvironment.createMobileEnvironmentCacheVersion(staging),
    ).not.toBe(mobileEnvironment.createMobileEnvironmentCacheVersion(local));
  });

  test('exports the selected fingerprint as Metro cacheVersion', () => {
    Object.assign(process.env, {
      BABEL_ENV: 'test',
      NODE_ENV: 'test',
      MOBILE_ENVIRONMENT: 'local',
      OPEN_METEO_API_KEY: 'metro-open-meteo-sentinel',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANDROID_URL: 'http://10.0.2.2:54321',
      SUPABASE_PUBLISHABLE_KEY: 'metro-publishable-sentinel',
      LOCAL_AUTH_EMAIL: 'metro-email-sentinel@example.invalid',
      LOCAL_AUTH_PASSWORD: 'metro-password-sentinel',
      GOOGLE_WEB_CLIENT_ID: 'metro-google-web-sentinel',
      GOOGLE_IOS_CLIENT_ID: 'metro-google-ios-sentinel',
    });
    const selected = mobileEnvironment.loadMobileEnvironment();
    const expected = mobileEnvironment.createMobileEnvironmentCacheVersion(
      selected,
    );
    const metroCacheVersion = createMetroEnvironmentConfig({
      environment: process.env,
      babelEnvironment: 'test',
      nodeEnvironment: 'test',
    }).cacheVersion;

    expect(metroCacheVersion).toBe(expected);
    expect(metroCacheVersion).not.toContain('metro-password-sentinel');
  });
});
