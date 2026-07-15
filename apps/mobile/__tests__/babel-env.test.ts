import {transformSync} from '@babel/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type MobileEnvironmentLoader = (options?: {
  environment?: NodeJS.ProcessEnv;
  babelEnvironment?: string;
  nodeEnvironment?: string;
  developmentEnvPath?: string;
}) => Record<string, string>;

const {loadMobileEnvironment} = require('../scripts/load-mobile-env') as {
  loadMobileEnvironment: MobileEnvironmentLoader;
};

const authIdentifiers = `
  export const authEnvironment = [
    __SUPABASE_URL__,
    __SUPABASE_PUBLISHABLE_KEY__,
    __GOOGLE_WEB_CLIENT_ID__,
    __GOOGLE_IOS_CLIENT_ID__,
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

  test('reads development file only when neither Babel nor Node is production', () => {
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
        babelEnvironment: 'development',
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
        babelEnvironment: 'development',
        nodeEnvironment: 'production',
        developmentEnvPath,
      }).SUPABASE_URL,
    ).toBeUndefined();
  });

  test('inlines process values while leaving unknown identifiers untouched', () => {
    process.env.SUPABASE_URL = 'https://process.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'process-key';
    process.env.GOOGLE_WEB_CLIENT_ID = 'web-id';
    process.env.GOOGLE_IOS_CLIENT_ID = 'ios-id';

    const code = transform(
      `${authIdentifiers}\nexport const untouched = __UNKNOWN_IDENTIFIER__;`,
      'process-env-test',
    );

    expect(code).toContain('https://process.supabase.co');
    expect(code).toContain('process-key');
    expect(code).toContain('web-id');
    expect(code).toContain('ios-id');
    expect(code).toContain('__UNKNOWN_IDENTIFIER__');
  });

  test('never treats Object prototype names as environment identifiers', () => {
    const code = transform(
      'export const preserved = toString;',
      'prototype-identifier-test',
    );

    expect(code).toContain('toString');
    expect(code).not.toContain('preserved=""');
  });

  test('production envName inlines empty strings without development fallback', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.GOOGLE_WEB_CLIENT_ID;
    delete process.env.GOOGLE_IOS_CLIENT_ID;
    delete process.env.NODE_ENV;
    delete process.env.BABEL_ENV;

    const code = transform(authIdentifiers, 'production');
    expect(code.match(/""/g)?.length).toBe(4);
  });

  test('does not replace local bindings or non-computed object keys', () => {
    process.env.SUPABASE_URL = 'https://global.supabase.co';
    const code = transform(
      `
        const __SUPABASE_URL__ = 'local-binding';
        export const local = __SUPABASE_URL__;
        export const object = { __SUPABASE_URL__: 1 };
      `,
      'binding-test',
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
