import {Platform} from 'react-native';

declare const __OPEN_METEO_API_KEY__: string | undefined;
declare const __SUPABASE_URL__: string | undefined;
declare const __SUPABASE_ANDROID_URL__: string | undefined;
declare const __SUPABASE_PUBLISHABLE_KEY__: string | undefined;
declare const __LOCAL_AUTH_EMAIL__: string | undefined;
declare const __LOCAL_AUTH_PASSWORD__: string | undefined;
declare const __GOOGLE_WEB_CLIENT_ID__: string | undefined;
declare const __GOOGLE_IOS_CLIENT_ID__: string | undefined;

type SupabaseEnvironmentInput = {
  url: string | undefined;
  androidUrl?: string | undefined;
  publishableKey: string | undefined;
};

type LocalDevelopmentAuthEnvironmentInput = {
  url: string | undefined;
  email: string | undefined;
  password: string | undefined;
};

type GoogleEnvironmentInput = {
  webClientId: string | undefined;
  iosClientId: string | undefined;
};

export type SupabaseEnvironment = {
  url: string;
  publishableKey: string;
};

export type GoogleEnvironment = {
  webClientId: string;
  iosClientId: string;
};

export type LocalDevelopmentAuthEnvironment = {
  email: string;
  password: string;
};

const invalidSupabaseUrl = () =>
  new Error('Invalid SUPABASE_URL configuration');

export const parseSupabaseEnvironment = (
  input: SupabaseEnvironmentInput,
  isDevelopment: boolean,
  platform: 'android' | 'ios' = Platform.OS === 'android' ? 'android' : 'ios',
): SupabaseEnvironment | undefined => {
  const androidUrl = input.androidUrl?.trim();
  const url =
    (platform === 'android' ? androidUrl || input.url : input.url)?.trim() ??
    '';
  const publishableKey = input.publishableKey?.trim() ?? '';

  if (!url || !publishableKey) {
    return undefined;
  }

  if (!/^https?:\/\//i.test(url)) {
    throw invalidSupabaseUrl();
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw invalidSupabaseUrl();
  }

  const isHttps = parsedUrl.protocol === 'https:';
  const isLocalDevelopmentHttp =
    isDevelopment &&
    parsedUrl.protocol === 'http:' &&
    (parsedUrl.hostname === 'localhost' ||
      parsedUrl.hostname === '127.0.0.1' ||
      parsedUrl.hostname === '10.0.2.2');

  if (
    parsedUrl.username ||
    parsedUrl.password ||
    (!isHttps && !isLocalDevelopmentHttp)
  ) {
    throw invalidSupabaseUrl();
  }

  return {url, publishableKey};
};

export const parseLocalDevelopmentAuthEnvironment = (
  input: LocalDevelopmentAuthEnvironmentInput,
  isDevelopment: boolean,
): LocalDevelopmentAuthEnvironment | undefined => {
  const url = input.url?.trim() ?? '';
  const email = input.email?.trim() ?? '';
  const password = input.password?.trim() ?? '';

  if (!isDevelopment || !url || !email || !password) {
    return undefined;
  }

  let host: string;

  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }

  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '10.0.2.2') {
    return undefined;
  }

  return {email, password};
};

export const parseGoogleEnvironment = (
  input: GoogleEnvironmentInput,
): GoogleEnvironment | undefined => {
  const webClientId = input.webClientId?.trim() ?? '';
  const iosClientId = input.iosClientId?.trim() ?? '';

  if (!webClientId || !iosClientId) {
    return undefined;
  }

  return {webClientId, iosClientId};
};

export const openMeteoApiKey =
  typeof __OPEN_METEO_API_KEY__ === 'string' ? __OPEN_METEO_API_KEY__ : '';

export const getSupabaseEnvironment = () =>
  parseSupabaseEnvironment(
    {
      url:
        typeof __SUPABASE_URL__ === 'string' ? __SUPABASE_URL__ : undefined,
      androidUrl:
        typeof __SUPABASE_ANDROID_URL__ === 'string'
          ? __SUPABASE_ANDROID_URL__
          : undefined,
      publishableKey:
        typeof __SUPABASE_PUBLISHABLE_KEY__ === 'string'
          ? __SUPABASE_PUBLISHABLE_KEY__
          : undefined,
    },
    __DEV__,
  );

export const getLocalDevelopmentAuthEnvironment = () => {
  const supabase = getSupabaseEnvironment();

  return parseLocalDevelopmentAuthEnvironment(
    {
      url: supabase?.url,
      email:
        typeof __LOCAL_AUTH_EMAIL__ === 'string'
          ? __LOCAL_AUTH_EMAIL__
          : undefined,
      password:
        typeof __LOCAL_AUTH_PASSWORD__ === 'string'
          ? __LOCAL_AUTH_PASSWORD__
          : undefined,
    },
    __DEV__,
  );
};

export const getGoogleEnvironment = () =>
  parseGoogleEnvironment({
    webClientId:
      typeof __GOOGLE_WEB_CLIENT_ID__ === 'string'
        ? __GOOGLE_WEB_CLIENT_ID__
        : undefined,
    iosClientId:
      typeof __GOOGLE_IOS_CLIENT_ID__ === 'string'
        ? __GOOGLE_IOS_CLIENT_ID__
        : undefined,
  });
