import {
  AuthRepositoryError,
  type AuthRepository,
  type OnboardingStatus,
  type RequiredLegalDocument,
  type Session,
  type StoredSessionEvidence,
} from '@repo/supabase';
import React from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  createMobileAuth,
  type MobileAuth,
} from '../src/auth/create-mobile-auth';
import {
  createMembershipCache,
  type MembershipCache,
  type MembershipCacheEntry,
} from '../src/auth/membership-cache';
import type {NativeSocialSignIn} from '../src/auth/native-social-auth';
import type {RecentSocialProviderStore} from '../src/auth/recent-social-provider';
import type {PersistentKeyValueStore} from '../src/storage/persistent-key-value-store';
import {
  AuthProvider,
  type AuthContextValue,
  useAuth,
} from '../src/states/auth';

const now = 2_000_000_000;
const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';

const requiredDocuments: RequiredLegalDocument[] = [
  {
    kind: 'terms',
    version: '2026-07-01',
    effectiveAt: '2026-07-01T00:00:00Z',
    documentUrl: 'https://example.com/terms/2026-07-01',
  },
  {
    kind: 'privacy',
    version: '2026-07-01',
    effectiveAt: '2026-07-01T00:00:00Z',
    documentUrl: 'https://example.com/privacy/2026-07-01',
  },
];

const requestedDocuments = requiredDocuments.map(({kind, version}) => ({
  kind,
  version,
}));

const completeStatus: OnboardingStatus = {
  isComplete: true,
  onboardingCompletedAt: '2026-07-02T00:00:00Z',
  requiredDocuments,
  acceptedDocuments: requestedDocuments,
};

const pendingStatus: OnboardingStatus = {
  isComplete: false,
  onboardingCompletedAt: null,
  requiredDocuments,
  acceptedDocuments: [],
};

const session = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  expires_at: now + 3600,
  token_type: 'bearer',
  user: {
    id: userId,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-07-01T00:00:00Z',
  },
} as Session;

const evidence: StoredSessionEvidence = {
  session,
  userId,
  expiresAt: now + 3600,
};

const cachedMembership: MembershipCacheEntry = {
  userId,
  serverVerifiedAt: now - 30,
  onboardingCompletedAt: '2026-07-02T00:00:00Z',
  documents: requestedDocuments,
};

let latestAuth: AuthContextValue;
let appStateListener: ((state: AppStateStatus) => void) | undefined;
let appStateRemove: jest.Mock;
let appStateSpy: jest.SpyInstance;
const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

function CaptureAuth() {
  latestAuth = useAuth();
  return null;
}

beforeEach(() => {
  appStateListener = undefined;
  appStateRemove = jest.fn();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  appStateSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      appStateListener = listener;
      return {remove: appStateRemove};
    });
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    for (const renderer of mountedRenderers.splice(0)) {
      renderer.unmount();
    }
  });
  appStateSpy.mockRestore();
});

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountAuth(mobileAuth: MobileAuth | undefined) {
  await ReactTestRenderer.act(async () => {
    mountedRenderers.push(
      ReactTestRenderer.create(
        <AuthProvider createAuth={() => mobileAuth}>
          <CaptureAuth />
        </AuthProvider>,
      ),
    );
  });
  await settle();
  return latestAuth;
}

function createAuthFixture(options?: {
  evidence?: StoredSessionEvidence;
  status?: OnboardingStatus;
  cache?: MembershipCacheEntry;
  providers?: Partial<Record<'google' | 'apple', NativeSocialSignIn>>;
}) {
  let authListener: ((session: Session | null) => void) | undefined;
  const unsubscribe = jest.fn();
  const repository = {
    signInWithIdToken: jest.fn(
      async (_input: Parameters<AuthRepository['signInWithIdToken']>[0]) =>
        session,
    ),
    getStoredSessionEvidence: jest.fn(async () => options?.evidence),
    verifyClaims: jest.fn(async (_accessToken: string) => ({
      userId: options?.evidence?.userId ?? userId,
      expiresAt: options?.evidence?.expiresAt ?? now + 3600,
    })),
    verifySessionWithServer: jest.fn(async (_accessToken: string) => ({
      userId: options?.evidence?.userId ?? userId,
    })),
    getOnboardingStatus: jest.fn(async () => options?.status ?? completeStatus),
    completeOnboarding: jest.fn(
      async (_documents: Parameters<AuthRepository['completeOnboarding']>[0]) =>
        completeStatus,
    ),
    signOut: jest.fn(async () => undefined),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
    subscribe: jest.fn(
      (listener: Parameters<AuthRepository['subscribe']>[0]) => {
      authListener = listener;
      return unsubscribe;
      },
    ),
  } as jest.Mocked<AuthRepository>;
  const membershipCache = {
    load: jest.fn(async () => options?.cache),
    save: jest.fn(async (_entry: MembershipCacheEntry) => undefined),
    remove: jest.fn(async () => undefined),
  } as jest.Mocked<MembershipCache>;
  const recentProviderStore = {
    load: jest.fn(async () => undefined),
    save: jest.fn(async (_provider: 'google' | 'apple') => undefined),
  } as jest.Mocked<RecentSocialProviderStore>;
  const mobileAuth: MobileAuth = {
    repository,
    membershipCache,
    recentProviderStore,
    providers: options?.providers ?? {},
    now: () => now,
  };

  return {
    mobileAuth,
    repository,
    membershipCache,
    recentProviderStore,
    unsubscribe,
    emitAuth: (nextSession: Session | null) => authListener?.(nextSession),
  };
}

describe('AuthProvider', () => {
  test('boots an unconfigured app as guest without constructing a client', async () => {
    const createClient = jest.fn();

    expect(
      createMobileAuth({
        getSupabaseEnvironment: () => undefined,
        createSupabaseClient: createClient,
      }),
    ).toBeUndefined();
    expect(
      createMobileAuth({
        getSupabaseEnvironment: () => {
          throw new Error('Invalid SUPABASE_URL configuration');
        },
        createSupabaseClient: createClient,
      }),
    ).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();

    appStateSpy.mockClear();
    const auth = await mountAuth(undefined);
    expect(auth.isConfigured).toBe(false);
    expect(auth.state).toEqual({status: 'guest'});
    expect(appStateSpy).not.toHaveBeenCalled();
  });

  test('boots guest with no stored session and owns one listener of each kind', async () => {
    const fixture = createAuthFixture();
    const auth = await mountAuth(fixture.mobileAuth);

    expect(auth.state).toEqual({status: 'guest'});
    expect(auth.isConfigured).toBe(true);
    expect(fixture.repository.getStoredSessionEvidence).toHaveBeenCalledTimes(1);
    expect(fixture.repository.subscribe).toHaveBeenCalledTimes(1);
    expect(appStateSpy).toHaveBeenCalledTimes(1);
    expect(fixture.repository.startAutoRefresh).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      mountedRenderers.pop()?.unmount();
    });
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
    expect(appStateRemove).toHaveBeenCalledTimes(1);
    expect(fixture.repository.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  test('validates stored evidence, claims, server user, and current consent in order', async () => {
    const fixture = createAuthFixture({evidence, status: completeStatus});
    const auth = await mountAuth(fixture.mobileAuth);

    expect(auth.state).toEqual({status: 'authenticated', userId});
    expect(fixture.repository.verifyClaims).toHaveBeenCalledWith('access-token');
    expect(fixture.repository.verifySessionWithServer).toHaveBeenCalledWith(
      'access-token',
    );
    expect(
      fixture.repository.getStoredSessionEvidence.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.repository.verifyClaims.mock.invocationCallOrder[0]!);
    expect(
      fixture.repository.verifyClaims.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.repository.verifySessionWithServer.mock.invocationCallOrder[0]!,
    );
    expect(
      fixture.repository.verifySessionWithServer.mock.invocationCallOrder[0],
    ).toBeLessThan(
      fixture.repository.getOnboardingStatus.mock.invocationCallOrder[0]!,
    );
    expect(fixture.membershipCache.save).toHaveBeenCalledWith(
      cachedMembershipFor(completeStatus),
    );
  });

  test('blocks an incomplete or re-consent session and removes stale completion cache', async () => {
    const fixture = createAuthFixture({
      evidence,
      status: pendingStatus,
      cache: cachedMembership,
    });
    const auth = await mountAuth(fixture.mobileAuth);

    expect(auth.state).toEqual({
      status: 'pendingOnboarding',
      userId,
      documents: requiredDocuments,
    });
    expect(fixture.membershipCache.remove).toHaveBeenCalledTimes(1);
    expect(fixture.membershipCache.save).not.toHaveBeenCalled();
  });

  test('fails closed when an incomplete-consent cache cannot be removed', async () => {
    const fixture = createAuthFixture({
      evidence,
      status: pendingStatus,
      cache: cachedMembership,
    });
    fixture.membershipCache.remove.mockRejectedValue(
      new Error('membership cache unavailable'),
    );

    const auth = await mountAuth(fixture.mobileAuth);

    expect(auth.state).toEqual({status: 'guest'});
    expect(fixture.repository.signOut).toHaveBeenCalledTimes(1);
    expect(fixture.membershipCache.save).not.toHaveBeenCalled();
  });

  test('removes a stale cache when complete online status cannot be cached', async () => {
    let persistedCache: MembershipCacheEntry | undefined = cachedMembership;
    const fixture = createAuthFixture({
      evidence,
      status: completeStatus,
      cache: cachedMembership,
    });
    fixture.membershipCache.load.mockImplementation(
      async () => persistedCache,
    );
    fixture.membershipCache.save.mockRejectedValue(
      new Error('membership cache unavailable'),
    );
    fixture.membershipCache.remove.mockImplementation(async () => {
      persistedCache = undefined;
    });

    const auth = await mountAuth(fixture.mobileAuth);
    expect(auth.state).toEqual({status: 'authenticated', userId});
    expect(fixture.membershipCache.remove).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      mountedRenderers.pop()?.unmount();
    });

    fixture.repository.verifyClaims.mockRejectedValue(
      new AuthRepositoryError('network'),
    );
    const remounted = await mountAuth(fixture.mobileAuth);

    expect(remounted.state).toEqual({status: 'guest'});
    expect(fixture.membershipCache.load).toHaveBeenCalledTimes(1);
  });

  test('fails closed when neither complete cache save nor stale cache removal succeeds', async () => {
    const fixture = createAuthFixture({
      evidence,
      status: completeStatus,
      cache: cachedMembership,
    });
    fixture.membershipCache.save.mockRejectedValue(
      new Error('membership cache unavailable'),
    );
    fixture.membershipCache.remove.mockRejectedValue(
      new Error('membership cache unavailable'),
    );

    const auth = await mountAuth(fixture.mobileAuth);

    expect(auth.state).toEqual({status: 'guest'});
    expect(fixture.repository.signOut).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['claims user mismatch', 'claims-user'],
    ['claims expiry mismatch', 'claims-expiry'],
    ['server user mismatch', 'server-user'],
  ])('clears invalid local credentials for %s', async (_name, failure) => {
    const fixture = createAuthFixture({evidence, status: completeStatus});

    if (failure === 'claims-user') {
      fixture.repository.verifyClaims.mockResolvedValue({
        userId: otherUserId,
        expiresAt: evidence.expiresAt,
      });
    } else if (failure === 'claims-expiry') {
      fixture.repository.verifyClaims.mockResolvedValue({
        userId,
        expiresAt: evidence.expiresAt + 1,
      });
    } else {
      fixture.repository.verifySessionWithServer.mockResolvedValue({
        userId: otherUserId,
      });
    }

    const auth = await mountAuth(fixture.mobileAuth);
    expect(auth.state).toEqual({status: 'guest'});
    expect(fixture.repository.signOut).toHaveBeenCalledTimes(1);
    expect(fixture.membershipCache.remove).toHaveBeenCalledTimes(1);
  });

  test('clears a rejected session and does not use offline cache', async () => {
    const fixture = createAuthFixture({
      evidence,
      cache: cachedMembership,
    });
    fixture.repository.verifySessionWithServer.mockRejectedValue(
      new AuthRepositoryError('invalid-session'),
    );

    const auth = await mountAuth(fixture.mobileAuth);
    expect(auth.state).toEqual({status: 'guest'});
    expect(fixture.repository.signOut).toHaveBeenCalledTimes(1);
    expect(fixture.membershipCache.remove).toHaveBeenCalledTimes(1);
  });

  test('clears invalid credentials rejected while reading stored evidence', async () => {
    const fixture = createAuthFixture({cache: cachedMembership});
    fixture.repository.getStoredSessionEvidence.mockRejectedValue(
      new AuthRepositoryError('invalid-session'),
    );

    const auth = await mountAuth(fixture.mobileAuth);
    expect(auth.state).toEqual({status: 'guest'});
    expect(fixture.repository.signOut).toHaveBeenCalledTimes(1);
    expect(fixture.membershipCache.remove).toHaveBeenCalledTimes(1);
  });

  test.each(['claims', 'server'] as const)(
    'uses exact bounded offline membership on a %s transport failure',
    async stage => {
      const fixture = createAuthFixture({
        evidence,
        cache: cachedMembership,
      });
      fixture.repository[
        stage === 'claims' ? 'verifyClaims' : 'verifySessionWithServer'
      ].mockRejectedValue(new AuthRepositoryError('network'));

      const auth = await mountAuth(fixture.mobileAuth);
      expect(auth.state).toEqual({status: 'authenticatedOffline', userId});
      expect(fixture.membershipCache.load).toHaveBeenCalledTimes(1);
      expect(fixture.repository.signOut).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['expired evidence', {...evidence, expiresAt: now}],
    ['wrong cached user', evidence],
    ['missing cache', evidence],
  ])('rejects offline fallback for %s', async (scenario, storedEvidence) => {
    const fixture = createAuthFixture({
      evidence: storedEvidence,
      cache:
        scenario === 'missing cache'
          ? undefined
          : scenario === 'wrong cached user'
            ? {...cachedMembership, userId: otherUserId}
            : cachedMembership,
    });
    fixture.repository.verifyClaims.mockRejectedValue(
      new AuthRepositoryError('network'),
    );

    const auth = await mountAuth(fixture.mobileAuth);
    expect(auth.state).toEqual({status: 'guest'});
    expect(fixture.membershipCache.save).not.toHaveBeenCalled();
  });

  test('never treats a generic server failure as offline authentication', async () => {
    const fixture = createAuthFixture({
      evidence,
      cache: cachedMembership,
    });
    fixture.repository.verifyClaims.mockRejectedValue(
      new AuthRepositoryError('server'),
    );

    const auth = await mountAuth(fixture.mobileAuth);
    expect(auth.state).toEqual({status: 'guest'});
    expect(fixture.membershipCache.load).not.toHaveBeenCalled();
  });

  test('treats provider cancellation as neutral', async () => {
    const google = jest.fn(async () => ({type: 'cancelled'} as const));
    const fixture = createAuthFixture({providers: {google}});
    await mountAuth(fixture.mobileAuth);

    await ReactTestRenderer.act(async () => {
      await latestAuth.signIn('google');
    });

    expect(latestAuth.state).toEqual({status: 'guest'});
    expect(fixture.repository.signInWithIdToken).not.toHaveBeenCalled();
    expect(fixture.recentProviderStore.save).not.toHaveBeenCalled();
  });

  test('exchanges one native credential, saves only recent provider, and revalidates', async () => {
    const google = jest.fn(async () => ({
      type: 'credential',
      credential: {provider: 'google', idToken: 'google-id-token'},
    } as const));
    const fixture = createAuthFixture({
      evidence,
      status: completeStatus,
      providers: {google},
    });
    fixture.repository.getStoredSessionEvidence
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(evidence);
    await mountAuth(fixture.mobileAuth);

    await ReactTestRenderer.act(async () => {
      await latestAuth.signIn('google');
    });
    await settle();

    expect(fixture.repository.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
    });
    expect(fixture.recentProviderStore.save).toHaveBeenCalledWith('google');
    expect(latestAuth.recentProvider).toBe('google');
    expect(latestAuth.state).toEqual({status: 'authenticated', userId});
  });

  test('does not fail authentication when the recent-provider preference cannot save', async () => {
    const google = jest.fn(async () => ({
      type: 'credential',
      credential: {provider: 'google', idToken: 'google-id-token'},
    } as const));
    const fixture = createAuthFixture({
      evidence,
      status: completeStatus,
      providers: {google},
    });
    fixture.repository.getStoredSessionEvidence
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(evidence);
    fixture.recentProviderStore.save.mockRejectedValue(
      new Error('preference unavailable'),
    );
    await mountAuth(fixture.mobileAuth);

    await ReactTestRenderer.act(async () => {
      await latestAuth.signIn('google');
    });
    await settle();

    expect(latestAuth.state).toEqual({status: 'authenticated', userId});
    expect(latestAuth.recentProvider).toBeUndefined();
  });

  test('serializes double-tapped sign-in', async () => {
    const deferred = createDeferred<Awaited<ReturnType<NativeSocialSignIn>>>();
    const google = jest.fn(() => deferred.promise);
    const fixture = createAuthFixture({providers: {google}});
    await mountAuth(fixture.mobileAuth);

    let first!: Promise<void>;
    let second!: Promise<void>;
    ReactTestRenderer.act(() => {
      first = latestAuth.signIn('google');
      second = latestAuth.signIn('google');
    });

    expect(first).toBe(second);
    expect(google).toHaveBeenCalledTimes(1);

    deferred.resolve({type: 'cancelled'});
    await ReactTestRenderer.act(async () => {
      await Promise.all([first, second]);
    });
    expect(fixture.repository.signInWithIdToken).not.toHaveBeenCalled();
  });

  test('keeps explicit sign-out authoritative over a late token exchange', async () => {
    const exchange = createDeferred<Session>();
    const google = jest.fn(async () => ({
      type: 'credential',
      credential: {provider: 'google', idToken: 'google-id-token'},
    } as const));
    const fixture = createAuthFixture({
      evidence,
      status: completeStatus,
      providers: {google},
    });
    fixture.repository.getStoredSessionEvidence
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(evidence);
    fixture.repository.signInWithIdToken.mockImplementation(async () => {
      const exchangedSession = await exchange.promise;
      fixture.emitAuth(exchangedSession);
      return exchangedSession;
    });
    fixture.repository.signOut.mockRejectedValue(
      new AuthRepositoryError('network'),
    );
    await mountAuth(fixture.mobileAuth);

    let signInPromise!: Promise<void>;
    ReactTestRenderer.act(() => {
      signInPromise = latestAuth.signIn('google');
    });
    await settle();
    expect(fixture.repository.signInWithIdToken).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      await latestAuth.signOut();
    });
    exchange.resolve(session);
    await ReactTestRenderer.act(async () => {
      await signInPromise;
    });
    await settle();

    expect(latestAuth.state).toEqual({status: 'guest'});
    expect(
      fixture.repository.signOut.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(fixture.recentProviderStore.save).not.toHaveBeenCalled();
  });

  test('does not cancel native sign-in when foreground revalidation finishes first', async () => {
    const nativeResult = createDeferred<
      Awaited<ReturnType<NativeSocialSignIn>>
    >();
    const google = jest.fn(() => nativeResult.promise);
    const fixture = createAuthFixture({
      evidence,
      status: completeStatus,
      providers: {google},
    });
    fixture.repository.getStoredSessionEvidence
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(evidence);
    await mountAuth(fixture.mobileAuth);

    let signInPromise!: Promise<void>;
    ReactTestRenderer.act(() => {
      signInPromise = latestAuth.signIn('google');
      appStateListener?.('background');
      appStateListener?.('active');
    });
    await settle();

    expect(latestAuth.state).toEqual({
      status: 'authenticating',
      provider: 'google',
    });

    nativeResult.resolve({
      type: 'credential',
      credential: {provider: 'google', idToken: 'google-id-token'},
    });
    await ReactTestRenderer.act(async () => {
      await signInPromise;
    });
    await settle();

    expect(fixture.repository.signInWithIdToken).toHaveBeenCalledTimes(1);
    expect(latestAuth.state).toEqual({status: 'authenticated', userId});
  });

  test('completes exact rendered consent and supports explicit cancel/logout', async () => {
    const fixture = createAuthFixture({evidence, status: pendingStatus});
    await mountAuth(fixture.mobileAuth);

    await ReactTestRenderer.act(async () => {
      await latestAuth.completeOnboarding(requestedDocuments);
    });
    expect(fixture.repository.completeOnboarding).toHaveBeenCalledWith(
      requestedDocuments,
    );
    expect(latestAuth.state).toEqual({status: 'authenticated', userId});

    await ReactTestRenderer.act(async () => {
      await latestAuth.signOut();
    });
    expect(latestAuth.state).toEqual({status: 'guest'});
    expect(fixture.repository.signOut).toHaveBeenCalledTimes(1);
    expect(fixture.membershipCache.remove).toHaveBeenCalled();
    expect(fixture.recentProviderStore.save).not.toHaveBeenCalledWith(undefined);

    await ReactTestRenderer.act(async () => {
      mountedRenderers.pop()?.unmount();
    });
    const restoredPending = createAuthFixture({
      evidence,
      status: pendingStatus,
    });
    await mountAuth(restoredPending.mobileAuth);
    expect(latestAuth.state.status).toBe('pendingOnboarding');

    await ReactTestRenderer.act(async () => {
      await latestAuth.cancelOnboarding();
    });
    expect(latestAuth.state).toEqual({status: 'guest'});
    expect(restoredPending.repository.signOut).toHaveBeenCalledTimes(1);
  });

  test('prevents consent operations while authenticated offline', async () => {
    const fixture = createAuthFixture({evidence, cache: cachedMembership});
    fixture.repository.verifyClaims.mockRejectedValue(
      new AuthRepositoryError('network'),
    );
    await mountAuth(fixture.mobileAuth);

    await ReactTestRenderer.act(async () => {
      await latestAuth.completeOnboarding(requestedDocuments).catch(() => undefined);
    });
    expect(fixture.repository.completeOnboarding).not.toHaveBeenCalled();
    expect(latestAuth.state).toEqual({status: 'authenticatedOffline', userId});
  });

  test('revalidates only on a transition back to foreground', async () => {
    const fixture = createAuthFixture({evidence, status: completeStatus});
    await mountAuth(fixture.mobileAuth);
    expect(fixture.repository.getStoredSessionEvidence).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => appStateListener?.('background'));
    expect(fixture.repository.stopAutoRefresh).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => appStateListener?.('active'));
    await settle();
    expect(fixture.repository.startAutoRefresh).toHaveBeenCalledTimes(2);
    expect(fixture.repository.getStoredSessionEvidence).toHaveBeenCalledTimes(2);

    ReactTestRenderer.act(() => appStateListener?.('active'));
    await settle();
    expect(fixture.repository.getStoredSessionEvidence).toHaveBeenCalledTimes(2);
  });

  test('ignores a stale bootstrap completion after an Auth sign-out event', async () => {
    const deferred = createDeferred<StoredSessionEvidence | undefined>();
    const fixture = createAuthFixture({evidence, status: completeStatus});
    fixture.repository.getStoredSessionEvidence.mockReturnValue(deferred.promise);

    await mountAuth(fixture.mobileAuth);
    expect(latestAuth.state).toEqual({status: 'bootstrapping'});

    ReactTestRenderer.act(() => fixture.emitAuth(null));
    expect(latestAuth.state).toEqual({status: 'guest'});

    deferred.resolve(evidence);
    await settle();
    expect(latestAuth.state).toEqual({status: 'guest'});
  });
});

describe('membership cache', () => {
  test('persists only strict, versioned, canonical complete membership fields', async () => {
    const values = new Map<string, string>();
    const storage: PersistentKeyValueStore = {
      getString: jest.fn(async key => values.get(key)),
      setString: jest.fn(async (key, value) => {
        values.set(key, value);
      }),
      remove: jest.fn(async key => {
        values.delete(key);
      }),
    };
    const cache = createMembershipCache({storage});

    await cache.save({
      ...cachedMembership,
      documents: [...cachedMembership.documents].reverse(),
    });

    const raw = [...values.values()][0];
    expect(JSON.parse(raw ?? '{}')).toEqual({
      schemaVersion: 1,
      ...cachedMembership,
    });
    await expect(cache.load()).resolves.toEqual(cachedMembership);
  });

  test.each([
    'not-json',
    JSON.stringify({...cachedMembership, schemaVersion: 2}),
    JSON.stringify({...cachedMembership, schemaVersion: 1, token: 'secret'}),
    JSON.stringify({
      ...cachedMembership,
      schemaVersion: 1,
      onboardingCompletedAt: '2026-02-30T00:00:00Z',
    }),
    JSON.stringify({
      ...cachedMembership,
      schemaVersion: 1,
      documents: [requestedDocuments[0], requestedDocuments[0]],
    }),
  ])('ignores malformed, expanded, or incomplete cache %#', async raw => {
    const storage: PersistentKeyValueStore = {
      getString: jest.fn(async () => raw),
      setString: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
    };
    await expect(
      createMembershipCache({storage}).load(),
    ).resolves.toBeUndefined();
  });
});

function cachedMembershipFor(status: OnboardingStatus): MembershipCacheEntry {
  return {
    userId,
    serverVerifiedAt: now,
    onboardingCompletedAt: status.onboardingCompletedAt!,
    documents: status.requiredDocuments.map(({kind, version}) => ({kind, version})),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}
