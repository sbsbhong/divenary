import {
  createAuthRepository,
  createSupabaseClient,
  type AuthRepository,
} from '@repo/supabase';

import {getGoogleEnvironment, getSupabaseEnvironment} from '../config/env';
import {
  isAppleNativeAuthAvailable,
  signInWithApple,
} from './apple-native-auth';
import {createGoogleNativeAuth} from './google-native-auth';
import {supabaseSessionStorage} from './keychain-session-storage';
import {
  createMembershipCache,
  type MembershipCache,
} from './membership-cache';
import type {
  NativeSocialSignIn,
  SocialProvider,
} from './native-social-auth';
import {
  createRecentSocialProviderStore,
  type RecentSocialProviderStore,
} from './recent-social-provider';

export type MobileAuth = {
  repository: AuthRepository;
  membershipCache: MembershipCache;
  recentProviderStore: RecentSocialProviderStore;
  providers: Partial<Record<SocialProvider, NativeSocialSignIn>>;
  now: () => number;
};

export type CreateMobileAuthOptions = {
  getSupabaseEnvironment?: typeof getSupabaseEnvironment;
  getGoogleEnvironment?: typeof getGoogleEnvironment;
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthRepository?: typeof createAuthRepository;
  createMembershipCache?: typeof createMembershipCache;
  createRecentSocialProviderStore?: typeof createRecentSocialProviderStore;
  createGoogleNativeAuth?: typeof createGoogleNativeAuth;
  isAppleNativeAuthAvailable?: typeof isAppleNativeAuthAvailable;
  signInWithApple?: typeof signInWithApple;
  now?: () => number;
};

export function createMobileAuth(
  options: CreateMobileAuthOptions = {},
): MobileAuth | undefined {
  const readSupabaseEnvironment =
    options.getSupabaseEnvironment ?? getSupabaseEnvironment;
  const readGoogleEnvironment =
    options.getGoogleEnvironment ?? getGoogleEnvironment;
  const makeClient = options.createSupabaseClient ?? createSupabaseClient;
  const makeRepository = options.createAuthRepository ?? createAuthRepository;
  const makeMembershipCache =
    options.createMembershipCache ?? createMembershipCache;
  const makeRecentProviderStore =
    options.createRecentSocialProviderStore ?? createRecentSocialProviderStore;
  const makeGoogleAuth =
    options.createGoogleNativeAuth ?? createGoogleNativeAuth;
  const appleIsAvailable =
    options.isAppleNativeAuthAvailable ?? isAppleNativeAuthAvailable;
  const appleSignIn = options.signInWithApple ?? signInWithApple;

  try {
    const environment = readSupabaseEnvironment();

    if (environment === undefined) {
      return undefined;
    }

    const client = makeClient({
      ...environment,
      storage: supabaseSessionStorage,
    });
    const providers: MobileAuth['providers'] = {};
    const googleEnvironment = readGoogleEnvironment();

    if (googleEnvironment !== undefined) {
      providers.google = makeGoogleAuth(googleEnvironment);
    }

    if (appleIsAvailable()) {
      providers.apple = appleSignIn;
    }

    return {
      repository: makeRepository(client),
      membershipCache: makeMembershipCache(),
      recentProviderStore: makeRecentProviderStore(),
      providers,
      now: options.now ?? (() => Math.floor(Date.now() / 1000)),
    };
  } catch {
    return undefined;
  }
}
