import {
  parseLocalDevelopmentAuthEnvironment,
  parseGoogleEnvironment,
  parseMobileEnvironmentMode,
  parseSupabaseEnvironment,
} from '../src/config/env';

describe('mobile public Auth environment', () => {
  test('normalizes only known inlined mobile environment modes', () => {
    expect(parseMobileEnvironmentMode('local')).toBe('local');
    expect(parseMobileEnvironmentMode('staging')).toBe('staging');
    expect(parseMobileEnvironmentMode('release')).toBe('release');
    expect(parseMobileEnvironmentMode('LOCAL')).toBe('release');
    expect(parseMobileEnvironmentMode('unknown')).toBe('release');
    expect(parseMobileEnvironmentMode(undefined)).toBe('release');
  });

  test('returns undefined unless both Supabase public values are present', () => {
    expect(
      parseSupabaseEnvironment({url: '', publishableKey: ''}, true),
    ).toBeUndefined();
    expect(
      parseSupabaseEnvironment(
        {url: 'https://project.supabase.co', publishableKey: ''},
        true,
      ),
    ).toBeUndefined();
    expect(
      parseSupabaseEnvironment(
        {url: '', publishableKey: 'sb_publishable_test'},
        true,
      ),
    ).toBeUndefined();
  });

  test('returns only validated public Supabase configuration', () => {
    const result = parseSupabaseEnvironment(
      {
        url: 'https://project.supabase.co',
        publishableKey: 'sb_publishable_test',
      },
      false,
    );

    expect(result).toEqual({
      url: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_test',
    });
    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('serviceRole');
  });

  test('allows local HTTP only for loopback or the Android emulator in development', () => {
    expect(
      parseSupabaseEnvironment(
        {url: 'http://localhost:54321', publishableKey: 'local-key'},
        true,
      ),
    ).toEqual({url: 'http://localhost:54321', publishableKey: 'local-key'});
    expect(
      parseSupabaseEnvironment(
        {url: 'http://127.0.0.1:54321', publishableKey: 'local-key'},
        true,
      ),
    ).toEqual({url: 'http://127.0.0.1:54321', publishableKey: 'local-key'});
    expect(
      parseSupabaseEnvironment(
        {
          url: 'http://127.0.0.1:54321',
          androidUrl: 'http://10.0.2.2:54321',
          publishableKey: 'local-key',
        },
        true,
        'android',
      ),
    ).toEqual({url: 'http://10.0.2.2:54321', publishableKey: 'local-key'});
    expect(
      parseSupabaseEnvironment(
        {
          url: 'http://127.0.0.1:54321',
          androidUrl: '',
          publishableKey: 'local-key',
        },
        true,
        'android',
      ),
    ).toEqual({url: 'http://127.0.0.1:54321', publishableKey: 'local-key'});

    expect(() =>
      parseSupabaseEnvironment(
        {url: 'http://127.0.0.1:54321', publishableKey: 'local-key'},
        false,
      ),
    ).toThrow('SUPABASE_URL');
    expect(() =>
      parseSupabaseEnvironment(
        {url: 'http://192.168.0.10:54321', publishableKey: 'local-key'},
        true,
      ),
    ).toThrow('SUPABASE_URL');
  });

  test('rejects malformed URLs and never embeds the configured value in errors', () => {
    const configuredValue = 'not-a-secret-but-do-not-echo';

    expect(() =>
      parseSupabaseEnvironment(
        {url: configuredValue, publishableKey: 'publishable'},
        true,
      ),
    ).toThrow('SUPABASE_URL');

    try {
      parseSupabaseEnvironment(
        {url: configuredValue, publishableKey: 'publishable'},
        true,
      );
    } catch (error) {
      expect(String(error)).not.toContain(configuredValue);
    }
  });

  test('rejects non-canonical HTTP and HTTPS URL forms', () => {
    for (const url of [
      'https:project.supabase.co',
      'https:/project.supabase.co',
      'http:localhost:54321',
    ]) {
      expect(() =>
        parseSupabaseEnvironment(
          {url, publishableKey: 'publishable'},
          true,
        ),
      ).toThrow('SUPABASE_URL');
    }
  });

  test('requires both Google public client IDs', () => {
    expect(
      parseGoogleEnvironment({webClientId: '', iosClientId: ''}),
    ).toBeUndefined();
    expect(
      parseGoogleEnvironment({webClientId: 'web-id', iosClientId: ''}),
    ).toBeUndefined();
    expect(
      parseGoogleEnvironment({webClientId: '', iosClientId: 'ios-id'}),
    ).toBeUndefined();
    expect(
      parseGoogleEnvironment({webClientId: 'web-id', iosClientId: 'ios-id'}),
    ).toEqual({webClientId: 'web-id', iosClientId: 'ios-id'});
  });

  test('returns local password credentials only for development loopback environments', () => {
    for (const url of [
      'http://localhost:54321',
      'http://127.0.0.1:54321',
      'http://10.0.2.2:54321',
    ]) {
      expect(
        parseLocalDevelopmentAuthEnvironment(
          {
            url,
            email: 'divenary-local@development.invalid',
            password: 'generated-password',
          },
          true,
          'local',
        ),
      ).toEqual({
        email: 'divenary-local@development.invalid',
        password: 'generated-password',
      });
    }

    expect(
      parseLocalDevelopmentAuthEnvironment(
        {
          url: 'https://staging.supabase.co',
          email: 'divenary-local@development.invalid',
          password: 'generated-password',
        },
        true,
        'local',
      ),
    ).toBeUndefined();
    expect(
      parseLocalDevelopmentAuthEnvironment(
        {
          url: 'http://127.0.0.1:54321',
          email: 'divenary-local@development.invalid',
          password: 'generated-password',
        },
        false,
        'local',
      ),
    ).toBeUndefined();
    expect(
      parseLocalDevelopmentAuthEnvironment(
        {
          url: 'http://127.0.0.1:54321',
          email: '',
          password: 'generated-password',
        },
        true,
        'local',
      ),
    ).toBeUndefined();

    for (const mode of ['staging', 'release'] as const) {
      expect(
        parseLocalDevelopmentAuthEnvironment(
          {
            url: 'http://127.0.0.1:54321',
            email: 'divenary-local@development.invalid',
            password: 'generated-password',
          },
          true,
          mode,
        ),
      ).toBeUndefined();
    }
  });
});
