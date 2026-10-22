import {
  AuthRepositoryError,
  type AccountDataRepository,
  type GuestClaimRemoteRepository,
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
import {ASYNC_FEEDBACK_TIMING} from '../constants/async-feedback';

export type AuthState =
  | {status: 'bootstrapping'}
  | {status: 'guest'}
  | {
      status: 'authenticating';
      provider: SocialProvider | 'development';
      /**
       * 'exchanging' once the provider has handed back a credential and the server is checking it.
       * Absent while the provider's own sign-in screen is still open.
       */
      phase?: 'exchanging';
    }
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
  isDevelopmentSignInAvailable: boolean;
  recentProvider: SocialProvider | undefined;
  accountDataRepository?: AccountDataRepository;
  guestClaimRemoteRepository?: GuestClaimRemoteRepository;
  signIn(provider: SocialProvider): Promise<void>;
  signInForDevelopment(): Promise<void>;
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
  // The start shell offers an action at the long-running mark. Until the first check settles, its
  // network steps share that budget, so on a weak signal the diver reaches the records on this
  // phone by then instead of waiting on one slow step after another.
  const [bootstrapDeadline] = React.useState(
    () => Date.now() + ASYNC_FEEDBACK_TIMING.longRunning,
  );

  const updateState = React.useCallback((nextState: AuthState) => {
    if (!mountedRef.current) {
      return;
    }
    // Revalidation runs on every foreground and token refresh and usually lands on the same
    // state. Keeping the current object then stops every consumer from redoing its bootstrap.
    if (JSON.stringify(stateRef.current) === JSON.stringify(nextState)) {
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
      const [signOutResult] = await Promise.allSettled([
        mobileAuth.repository.signOut(),
        mobileAuth.membershipCache.remove(),
      ]);

      if (signOutResult.status === 'rejected') {
        // Supabase keeps an expired session when it cannot refresh before signing out.
        await mobileAuth.clearPersistedSession?.().catch(() => undefined);
      }
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
    // Every network step ends by the long-running mark at the latest. Running out counts as a
    // network failure, so it takes the same path as one and never signs the diver out. With
    // budget 'start', a step at launch also ends when the start shell's budget runs out.
    const withinStepLimit = <T,>(
      step: Promise<T>,
      operation: CheckOperation,
      budget: 'step' | 'start',
    ): Promise<T> => {
      const status = stateRef.current.status;

      if (status === 'authenticating') {
        // The locked login sheet tells the diver about a slow check itself. Ending the check here
        // would drop someone who just signed in back to guest without a word.
        return step;
      }

      return settleWithin(
        step,
        budget === 'start' && status === 'bootstrapping'
          ? Math.min(
              ASYNC_FEEDBACK_TIMING.longRunning,
              Math.max(0, bootstrapDeadline - Date.now()),
            )
          : ASYNC_FEEDBACK_TIMING.longRunning,
        operation,
      );
    };
    let stored: Awaited<
      ReturnType<MobileAuth['repository']['getStoredSessionEvidence']>
    >;

    try {
      // Reading the stored session refreshes an expired one over the network first. It keeps its
      // own full limit even at launch: without the stored session there is nothing to open
      // offline, so cutting it short would leave a signed-in diver on guest.
      stored = await withinStepLimit(
        mobileAuth.repository.getStoredSessionEvidence(),
        'session',
        'step',
      );
    } catch (error) {
      if (isInvalidSessionError(error)) {
        await clearInvalidSession(operationId);
      } else if (isCurrentOperation(operationId)) {
        // Without the stored session there is nothing to restore offline. The session and the
        // membership cache stay, so a later token refresh or foreground check brings the account
        // back.
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
      claims = await withinStepLimit(
        mobileAuth.repository.verifyClaims(stored.session.access_token),
        'session',
        'start',
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
      verifiedUser = await withinStepLimit(
        mobileAuth.repository.verifySessionWithServer(
          stored.session.access_token,
        ),
        'session',
        'start',
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

    let status: OnboardingStatus;

    try {
      status = await withinStepLimit(
        mobileAuth.repository.getOnboardingStatus(),
        'rpc',
        'start',
      );
    } catch (error) {
      // A consent check that fails or times out is not grounds for the offline account
      // (supabase.md): the diver opens as guest, which still ends the start-shell wait.
      if (isInvalidSessionError(error)) {
        await clearInvalidSession(operationId);
      } else if (isCurrentOperation(operationId)) {
        updateState({status: 'guest'});
      }
      return;
    }

    try {
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
    bootstrapDeadline,
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

    const unsubscribe = mobileAuth.repository.subscribe((nextSession, event) => {
      if (nextSession === null) {
        if (event !== 'SIGNED_OUT') {
          // A null initial session also means "could not load or refresh"; revalidation decides.
          return;
        }
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
      // Local development sign-in has no provider screen; it goes straight to the server.
      updateState(
        provider === 'development'
          ? {status: 'authenticating', provider, phase: 'exchanging'}
          : {status: 'authenticating', provider},
      );

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

          // The provider screen is closed; from here the wait is the server checking the credential.
          updateState({status: 'authenticating', provider, phase: 'exchanging'});
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
  const authenticatedUserId =
    state.status === 'authenticated' || state.status === 'authenticatedOffline'
      ? state.userId
      : undefined;
  const accountDataRepository = React.useMemo(
    () =>
      authenticatedUserId === undefined
        ? undefined
        : mobileAuth?.accountDataRepositoryForUser?.(authenticatedUserId),
    [authenticatedUserId, mobileAuth],
  );
  const guestClaimRemoteRepository = React.useMemo(
    () =>
      authenticatedUserId === undefined
        ? undefined
        : mobileAuth?.guestClaimRemoteRepositoryForUser?.(authenticatedUserId),
    [authenticatedUserId, mobileAuth],
  );
  const contextValue = React.useMemo<AuthContextValue>(
    () => ({
      state,
      isConfigured: mobileAuth !== undefined,
      availableProviders,
      isDevelopmentSignInAvailable,
      recentProvider,
      accountDataRepository,
      guestClaimRemoteRepository,
      signIn,
      signInForDevelopment,
      completeOnboarding,
      cancelOnboarding: endLocalSession,
      signOut: endLocalSession,
    }),
    [
      availableProviders,
      accountDataRepository,
      completeOnboarding,
      endLocalSession,
      mobileAuth,
      guestClaimRemoteRepository,
      isDevelopmentSignInAvailable,
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

type CheckOperation = NonNullable<AuthRepositoryError['operation']>;

/**
 * Settles with the step, or with a network failure once `limitMs` passes. The step keeps running
 * and its late result is ignored.
 */
function settleWithin<T>(
  step: Promise<T>,
  limitMs: number,
  operation: CheckOperation,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new AuthRepositoryError('network', {operation, code: 'timeout'})),
      limitMs,
    );
    step.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
