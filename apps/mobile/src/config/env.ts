declare const __OPEN_METEO_API_KEY__: string | undefined;
declare const __SUPABASE_URL__: string | undefined;
declare const __SUPABASE_PUBLISHABLE_KEY__: string | undefined;
declare const __GOOGLE_WEB_CLIENT_ID__: string | undefined;
declare const __GOOGLE_IOS_CLIENT_ID__: string | undefined;

type SupabaseEnvironmentInput = {
  url: string | undefined;
  publishableKey: string | undefined;
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

const invalidSupabaseUrl = () =>
  new Error('Invalid SUPABASE_URL configuration');

export const parseSupabaseEnvironment = (
  input: SupabaseEnvironmentInput,
  isDevelopment: boolean,
): SupabaseEnvironment | undefined => {
  const url = input.url?.trim() ?? '';
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
    (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1');

  if (
    parsedUrl.username ||
    parsedUrl.password ||
    (!isHttps && !isLocalDevelopmentHttp)
  ) {
    throw invalidSupabaseUrl();
  }

  return {url, publishableKey};
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
      publishableKey:
        typeof __SUPABASE_PUBLISHABLE_KEY__ === 'string'
          ? __SUPABASE_PUBLISHABLE_KEY__
          : undefined,
    },
    __DEV__,
  );

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
