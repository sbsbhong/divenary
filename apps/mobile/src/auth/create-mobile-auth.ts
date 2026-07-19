import {
  createAccountDataRepository,
  createAuthRepository,
  createGuestClaimRemoteRepository,
  createSupabaseClient,
  type AccountDataRepository,
  type AuthRepository,
  type GuestClaimRemoteRepository,
  type Session,
} from '@repo/supabase';

import {
  getGoogleEnvironment,
  getLocalDevelopmentAuthEnvironment,
  getMobileEnvironmentMode,
  getSupabaseEnvironment,
  isSupabaseEnvironmentForMobileMode,
} from '../config/env';
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
  accountDataRepositoryForUser?: (userId: string) => AccountDataRepository;
  guestClaimRemoteRepositoryForUser?: (
    userId: string,
  ) => GuestClaimRemoteRepository;
  developmentSignIn?: () => Promise<Session>;
  now: () => number;
};

export type CreateMobileAuthOptions = {
  getSupabaseEnvironment?: typeof getSupabaseEnvironment;
  getMobileEnvironmentMode?: typeof getMobileEnvironmentMode;
  getLocalDevelopmentAuthEnvironment?: typeof getLocalDevelopmentAuthEnvironment;
  getGoogleEnvironment?: typeof getGoogleEnvironment;
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthRepository?: typeof createAuthRepository;
  createAccountDataRepository?: typeof createAccountDataRepository;
  createGuestClaimRemoteRepository?: typeof createGuestClaimRemoteRepository;
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
  const readMobileEnvironmentMode =
    options.getMobileEnvironmentMode ?? getMobileEnvironmentMode;
  const readGoogleEnvironment =
    options.getGoogleEnvironment ?? getGoogleEnvironment;
  const readLocalDevelopmentAuthEnvironment =
    options.getLocalDevelopmentAuthEnvironment ??
    getLocalDevelopmentAuthEnvironment;
  const makeClient = options.createSupabaseClient ?? createSupabaseClient;
  const makeRepository = options.createAuthRepository ?? createAuthRepository;
  const makeAccountDataRepository =
    options.createAccountDataRepository ?? createAccountDataRepository;
  const makeGuestClaimRemoteRepository =
    options.createGuestClaimRemoteRepository ?? createGuestClaimRemoteRepository;
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
    const mobileEnvironmentMode = readMobileEnvironmentMode();

    if (mobileEnvironmentMode === 'release') {
      return undefined;
    }

    const environment = readSupabaseEnvironment();

    if (
      environment === undefined ||
      !isSupabaseEnvironmentForMobileMode(
        environment,
        mobileEnvironmentMode,
      )
    ) {
      return undefined;
    }

    const localDevelopmentAuthEnvironment =
      mobileEnvironmentMode === 'local'
        ? readLocalDevelopmentAuthEnvironment()
        : undefined;

    if (
      mobileEnvironmentMode === 'local' &&
      localDevelopmentAuthEnvironment === undefined
    ) {
      return undefined;
    }

    const client = makeClient({
      ...environment,
      storage: supabaseSessionStorage,
    });
    const repository = makeRepository(client);
    const providers: MobileAuth['providers'] = {};

    if (mobileEnvironmentMode === 'staging') {
      const googleEnvironment = readGoogleEnvironment();

      if (googleEnvironment !== undefined) {
        providers.google = makeGoogleAuth(googleEnvironment);
      }

      if (appleIsAvailable()) {
        providers.apple = appleSignIn;
      }
    }

    return {
      repository,
      membershipCache: makeMembershipCache(),
      recentProviderStore: makeRecentProviderStore(),
      providers,
      accountDataRepositoryForUser: userId =>
        makeAccountDataRepository(client, {userId}),
      guestClaimRemoteRepositoryForUser: userId =>
        makeGuestClaimRemoteRepository(client, {userId}),
      developmentSignIn:
        localDevelopmentAuthEnvironment === undefined
          ? undefined
          : () => repository.signInWithPassword(localDevelopmentAuthEnvironment),
      now: options.now ?? (() => Math.floor(Date.now() / 1000)),
    };
  } catch {
    return undefined;
  }
}
