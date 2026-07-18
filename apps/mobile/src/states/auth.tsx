import {
  AuthRepositoryError,
  type OnboardingStatus,
  type RequiredLegalDocument,
} from '@repo/supabase';
import React from 'react';
import {AppState, type AppStateStatus} from 'react-native';

import {
  createMobileAuth,
  type MobileAuth,
} from '../auth/create-mobile-auth';
import type {MembershipCacheEntry} from '../auth/membership-cache';
import {
  NativeSocialAuthError,
  type NativeSocialCredential,
  type SocialProvider,
} from '../auth/native-social-auth';

export type AuthState =
  | {status: 'bootstrapping'}
  | {status: 'guest'}
  | {status: 'authenticating'; provider: SocialProvider | 'development'}
  | {
      status: 'pendingOnboarding';
      userId: string;
      documents: RequiredLegalDocument[];
    }
  | {status: 'authenticated'; userId: string}
  | {status: 'authenticatedOffline'; userId: string};

export type AuthContextValue = {
  state: AuthState;
  isConfigured: boolean;
  availableProviders: SocialProvider[];
  isDevelopmentSignInAvailable?: boolean;
  recentProvider: SocialProvider | undefined;
  signIn(provider: SocialProvider): Promise<void>;
  signInForDevelopment?(): Promise<void>;
  completeOnboarding(
    documents: Array<{kind: 'terms' | 'privacy'; version: string}>,
  ): Promise<void>;
  cancelOnboarding(): Promise<void>;
  signOut(): Promise<void>;
};

export type AuthProviderProps = {
  children?: React.ReactNode;
  createAuth?: () => MobileAuth | undefined;
};

const AuthContext = React.createContext<AuthContextValue | undefined>(
  undefined,
);

export function AuthProvider(props: AuthProviderProps): React.JSX.Element {
  const [mobileAuth] = React.useState(() =>
    (props.createAuth ?? createMobileAuth)(),
  );
  const [state, setState] = React.useState<AuthState>(() =>
    mobileAuth === undefined
      ? {status: 'guest'}
      : {status: 'bootstrapping'},
  );
  const [recentProvider, setRecentProvider] = React.useState<
    SocialProvider | undefined
  >(undefined);
  const stateRef = React.useRef(state);
  const operationIdRef = React.useRef(0);
  const intentEpochRef = React.useRef(0);
  const offlineMembershipBlockedRef = React.useRef(false);
  const acceptsAuthenticatedSessionRef = React.useRef(true);
  const revalidationSuppressedRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const signInPromiseRef = React.useRef<Promise<void> | undefined>(undefined);

  const updateState = React.useCallback((nextState: AuthState) => {
    if (!mountedRef.current) {
      return;
    }

    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const isCurrentOperation = React.useCallback(
    (operationId: number) =>
      mountedRef.current && operationIdRef.current === operationId,
    [],
  );

  const isCurrentIntent = React.useCallback(
    (intentEpoch: number) =>
      mountedRef.current && intentEpochRef.current === intentEpoch,
    [],
  );

  const closeLocalSession = React.useCallback(async () => {
    operationIdRef.current += 1;
    intentEpochRef.current += 1;
    acceptsAuthenticatedSessionRef.current = false;
    revalidationSuppressedRef.current = false;
    offlineMembershipBlockedRef.current = true;
    updateState({status: 'guest'});

    if (mobileAuth !== undefined) {
      await Promise.allSettled([
        mobileAuth.repository.signOut(),
        mobileAuth.membershipCache.remove(),
      ]);
    }
  }, [mobileAuth, updateState]);

  const clearInvalidSession = React.useCallback(
    async (operationId: number) => {
      if (mobileAuth === undefined || !isCurrentOperation(operationId)) {
        return;
      }

      await closeLocalSession();
    },
    [closeLocalSession, isCurrentOperation, mobileAuth],
  );

  const restoreOfflineMembership = React.useCallback(
    async (
      operationId: number,
      stored: Awaited<
        ReturnType<MobileAuth['repository']['getStoredSessionEvidence']>
      >,
    ) => {
      if (
        mobileAuth === undefined ||
        stored === undefined ||
        stored.expiresAt <= mobileAuth.now() ||
        offlineMembershipBlockedRef.current
      ) {
        if (isCurrentOperation(operationId)) {
          updateState({status: 'guest'});
        }
        return;
      }

      let cached: MembershipCacheEntry | undefined;

      try {
        cached = await mobileAuth.membershipCache.load();
      } catch {
        cached = undefined;
      }

      if (!isCurrentOperation(operationId)) {
        return;
      }

      if (cached?.userId === stored.userId) {
        updateState({status: 'authenticatedOffline', userId: stored.userId});
      } else {
        updateState({status: 'guest'});
      }
    },
    [isCurrentOperation, mobileAuth, updateState],
  );

  const applyOnboardingStatus = React.useCallback(
    async (
      operationId: number,
      userId: string,
      status: OnboardingStatus,
    ) => {
      if (mobileAuth === undefined || !isCurrentOperation(operationId)) {
        return;
      }

      if (!status.isComplete || status.onboardingCompletedAt === null) {
        offlineMembershipBlockedRef.current = true;

        try {
          await mobileAuth.membershipCache.remove();
        } catch {
          if (isCurrentOperation(operationId)) {
            await closeLocalSession();
          }
          return;
        }

        if (isCurrentOperation(operationId)) {
          updateState({
            status: 'pendingOnboarding',
            userId,
            documents: status.requiredDocuments,
          });
        }
        return;
      }

      const cacheEntry: MembershipCacheEntry = {
        userId,
        serverVerifiedAt: mobileAuth.now(),
        onboardingCompletedAt: status.onboardingCompletedAt,
        documents: status.requiredDocuments.map(({kind, version}) => ({
          kind,
          version,
        })),
      };

      offlineMembershipBlockedRef.current = true;
      let cacheSaved = false;

      try {
        await mobileAuth.membershipCache.save(cacheEntry);
        cacheSaved = true;
      } catch {
        try {
          await mobileAuth.membershipCache.remove();
        } catch {
          if (isCurrentOperation(operationId)) {
            await closeLocalSession();
          }
          return;
        }
      }

      if (isCurrentOperation(operationId)) {
        if (cacheSaved) {
          offlineMembershipBlockedRef.current = false;
        }
        updateState({status: 'authenticated', userId});
      }
    },
    [closeLocalSession, isCurrentOperation, mobileAuth, updateState],
  );

  const revalidate = React.useCallback(async (expectedIntentEpoch?: number) => {
    if (mobileAuth === undefined) {
      updateState({status: 'guest'});
      return;
    }

    const intentEpoch = expectedIntentEpoch ?? intentEpochRef.current;

    if (
      revalidationSuppressedRef.current ||
      !acceptsAuthenticatedSessionRef.current ||
      !isCurrentIntent(intentEpoch)
    ) {
      return;
    }

    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    let stored: Awaited<
      ReturnType<MobileAuth['repository']['getStoredSessionEvidence']>
    >;

    try {
      stored = await mobileAuth.repository.getStoredSessionEvidence();
    } catch (error) {
      if (isInvalidSessionError(error)) {
        await clearInvalidSession(operationId);
      } else if (isCurrentOperation(operationId)) {
        updateState({status: 'guest'});
      }
      return;
    }

    if (!isCurrentOperation(operationId)) {
      return;
    }

    if (stored === undefined) {
      acceptsAuthenticatedSessionRef.current = false;
      offlineMembershipBlockedRef.current = true;

      try {
        await mobileAuth.membershipCache.remove();
      } catch {
        // Absence of a session remains authoritative.
      }

      if (isCurrentOperation(operationId)) {
        updateState({status: 'guest'});
      }
      return;
    }

    if (stored.expiresAt <= mobileAuth.now()) {
      await clearInvalidSession(operationId);
      return;
    }

    let claims: {userId: string; expiresAt: number};

    try {
      claims = await mobileAuth.repository.verifyClaims(
        stored.session.access_token,
      );
    } catch (error) {
      if (isNetworkError(error)) {
        await restoreOfflineMembership(operationId, stored);
      } else if (isInvalidSessionError(error)) {
        await clearInvalidSession(operationId);
      } else if (isCurrentOperation(operationId)) {
        updateState({status: 'guest'});
      }
      return;
    }

    if (!isCurrentOperation(operationId)) {
      return;
    }

    if (
      claims.userId !== stored.userId ||
      claims.expiresAt !== stored.expiresAt
    ) {
      await clearInvalidSession(operationId);
      return;
    }

    let verifiedUser: {userId: string};

    try {
      verifiedUser = await mobileAuth.repository.verifySessionWithServer(
        stored.session.access_token,
      );
    } catch (error) {
      if (isNetworkError(error)) {
        await restoreOfflineMembership(operationId, stored);
      } else if (isInvalidSessionError(error)) {
        await clearInvalidSession(operationId);
      } else if (isCurrentOperation(operationId)) {
        updateState({status: 'guest'});
      }
      return;
    }

    if (!isCurrentOperation(operationId)) {
      return;
    }

    if (verifiedUser.userId !== stored.userId) {
      await clearInvalidSession(operationId);
      return;
    }

    try {
      const status = await mobileAuth.repository.getOnboardingStatus();
      await applyOnboardingStatus(operationId, stored.userId, status);
    } catch (error) {
      if (isInvalidSessionError(error)) {
        await clearInvalidSession(operationId);
      } else if (isCurrentOperation(operationId)) {
        updateState({status: 'guest'});
      }
    }
  }, [
    applyOnboardingStatus,
    clearInvalidSession,
    isCurrentIntent,
    isCurrentOperation,
    mobileAuth,
    updateState,
    restoreOfflineMembership,
  ]);

  React.useEffect(() => {
    mountedRef.current = true;

    if (mobileAuth === undefined) {
      updateState({status: 'guest'});
      return () => {
        mountedRef.current = false;
      };
    }

    if (AppState.currentState === 'active') {
      mobileAuth.repository.startAutoRefresh();
    } else {
      mobileAuth.repository.stopAutoRefresh();
    }

    mobileAuth.recentProviderStore
      .load()
      .then(provider => {
        if (mountedRef.current) {
          setRecentProvider(provider);
        }
      })
      .catch(() => undefined);

    const unsubscribe = mobileAuth.repository.subscribe(nextSession => {
      if (nextSession === null) {
        operationIdRef.current += 1;
        intentEpochRef.current += 1;
        acceptsAuthenticatedSessionRef.current = false;
        revalidationSuppressedRef.current = false;
        offlineMembershipBlockedRef.current = true;
        updateState({status: 'guest'});
        mobileAuth.membershipCache.remove().catch(() => undefined);
        return;
      }

      if (!acceptsAuthenticatedSessionRef.current) {
        closeLocalSession().catch(() => undefined);
        return;
      }

      revalidate(intentEpochRef.current).catch(() => undefined);
    });
    let previousAppState = AppState.currentState as AppStateStatus;
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextAppState => {
        const wasActive = previousAppState === 'active';
        previousAppState = nextAppState;

        if (nextAppState === 'active') {
          mobileAuth.repository.startAutoRefresh();
          if (!wasActive) {
            revalidate(intentEpochRef.current).catch(() => undefined);
          }
        } else {
          mobileAuth.repository.stopAutoRefresh();
        }
      },
    );

    revalidate(intentEpochRef.current).catch(() => undefined);

    return () => {
      mountedRef.current = false;
      operationIdRef.current += 1;
      intentEpochRef.current += 1;
      unsubscribe();
      appStateSubscription.remove();
      mobileAuth.repository.stopAutoRefresh();
    };
  }, [closeLocalSession, mobileAuth, revalidate, updateState]);

  const performSignIn = React.useCallback(
    async (provider: SocialProvider | 'development') => {
      if (mobileAuth === undefined) {
        return;
      }

      const intentEpoch = intentEpochRef.current + 1;
      intentEpochRef.current = intentEpoch;
      operationIdRef.current += 1;
      acceptsAuthenticatedSessionRef.current = true;
      revalidationSuppressedRef.current = true;
      updateState({status: 'authenticating', provider});

      try {
        if (provider === 'development') {
          const developmentSignIn = mobileAuth.developmentSignIn;

          if (developmentSignIn === undefined) {
            throw new NativeSocialAuthError('unavailable');
          }

          await developmentSignIn();
        } else {
          const adapter = mobileAuth.providers[provider];

          if (adapter === undefined) {
            throw new NativeSocialAuthError('unavailable');
          }

          const result = await adapter();

          if (!isCurrentIntent(intentEpoch)) {
            return;
          }

          if (result.type === 'cancelled') {
            acceptsAuthenticatedSessionRef.current = false;
            revalidationSuppressedRef.current = false;
            updateState({status: 'guest'});
            return;
          }

          await mobileAuth.repository.signInWithIdToken(
            toSocialIdTokenInput(result.credential),
          );
        }

        if (!isCurrentIntent(intentEpoch)) {
          await closeLocalSession();
          return;
        }

        if (provider !== 'development') {
          try {
            await mobileAuth.recentProviderStore.save(provider);

            if (isCurrentIntent(intentEpoch)) {
              setRecentProvider(provider);
            }
          } catch {
            // This non-secret convenience preference must not block Auth.
          }
        }

        if (!isCurrentIntent(intentEpoch)) {
          return;
        }

        revalidationSuppressedRef.current = false;
        await revalidate(intentEpoch);
      } catch (error) {
        if (!isCurrentIntent(intentEpoch)) {
          return;
        }

        acceptsAuthenticatedSessionRef.current = false;
        revalidationSuppressedRef.current = false;
        offlineMembershipBlockedRef.current = true;

        if (isInvalidSessionError(error)) {
          await closeLocalSession();
        }
        updateState({status: 'guest'});
        throw error;
      }
    },
    [
      closeLocalSession,
      isCurrentIntent,
      mobileAuth,
      revalidate,
      updateState,
    ],
  );

  const signInOperation = React.useCallback(
    (provider: SocialProvider | 'development') => {
      if (signInPromiseRef.current !== undefined) {
        return signInPromiseRef.current;
      }

      const promise = performSignIn(provider);
      signInPromiseRef.current = promise;
      const clear = () => {
        if (signInPromiseRef.current === promise) {
          signInPromiseRef.current = undefined;
        }
      };
      promise.then(clear, clear);
      return promise;
    },
    [performSignIn],
  );

  const signIn = React.useCallback(
    (provider: SocialProvider) => signInOperation(provider),
    [signInOperation],
  );

  const signInForDevelopment = React.useCallback(
    () => signInOperation('development'),
    [signInOperation],
  );

  const endLocalSession = closeLocalSession;

  const completeOnboarding = React.useCallback(
    async (documents: Array<{kind: 'terms' | 'privacy'; version: string}>) => {
      if (
        mobileAuth === undefined ||
        stateRef.current.status !== 'pendingOnboarding'
      ) {
        throw new Error('Authentication operation unavailable');
      }

      const userId = stateRef.current.userId;
      const operationId = operationIdRef.current + 1;
      operationIdRef.current = operationId;

      try {
        const status = await mobileAuth.repository.completeOnboarding(documents);
        await applyOnboardingStatus(operationId, userId, status);
      } catch (error) {
        if (isInvalidSessionError(error)) {
          await clearInvalidSession(operationId);
        }
        throw error;
      }
    },
    [applyOnboardingStatus, clearInvalidSession, mobileAuth],
  );

  const availableProviders = React.useMemo(
    () =>
      (['google', 'apple'] as const).filter(
        provider => mobileAuth?.providers[provider] !== undefined,
      ),
    [mobileAuth],
  );
  const isDevelopmentSignInAvailable =
    mobileAuth?.developmentSignIn !== undefined;
  const contextValue = React.useMemo<AuthContextValue>(
    () => ({
      state,
      isConfigured: mobileAuth !== undefined,
      availableProviders,
      isDevelopmentSignInAvailable,
      recentProvider,
      signIn,
      signInForDevelopment,
      completeOnboarding,
      cancelOnboarding: endLocalSession,
      signOut: endLocalSession,
    }),
    [
      availableProviders,
      completeOnboarding,
      endLocalSession,
      mobileAuth,
      recentProvider,
      signIn,
      signInForDevelopment,
      state,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = React.useContext(AuthContext);

  if (value === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return value;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof AuthRepositoryError && error.kind === 'network';
}

function isInvalidSessionError(error: unknown): boolean {
  return (
    error instanceof AuthRepositoryError && error.kind === 'invalid-session'
  );
}

function toSocialIdTokenInput(credential: NativeSocialCredential) {
  return credential.provider === 'google'
    ? {provider: 'google' as const, token: credential.idToken}
    : {
        provider: 'apple' as const,
        token: credential.idToken,
        nonce: credential.nonce,
      };
}
