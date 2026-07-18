import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

import type {Database} from './database.types.ts';
import {
  parseOnboardingStatus,
  type LegalDocumentKind,
  type OnboardingStatus,
} from './onboarding-status.ts';

export type SocialIdTokenInput =
  | {provider: 'google'; token: string}
  | {provider: 'apple'; token: string; nonce: string};

export type PasswordSignInInput = {email: string; password: string};

export type StoredSessionEvidence = {
  session: Session;
  userId: string;
  expiresAt: number;
};

export type AuthRepositoryErrorKind =
  | 'network'
  | 'invalid-session'
  | 'server';

export class AuthRepositoryError extends Error {
  readonly kind: AuthRepositoryErrorKind;
  readonly cause?: unknown;

  constructor(
    kind: AuthRepositoryErrorKind,
    options?: {cause?: unknown},
  ) {
    super('Authentication operation failed');
    this.name = 'AuthRepositoryError';
    this.kind = kind;
    this.cause = options?.cause;
  }
}

export interface AuthRepository {
  signInWithIdToken(input: SocialIdTokenInput): Promise<Session>;
  signInWithPassword(input: PasswordSignInInput): Promise<Session>;
  getStoredSessionEvidence(): Promise<StoredSessionEvidence | undefined>;
  verifyClaims(
    accessToken: string,
  ): Promise<{userId: string; expiresAt: number}>;
  verifySessionWithServer(accessToken: string): Promise<{userId: string}>;
  getOnboardingStatus(): Promise<OnboardingStatus>;
  completeOnboarding(
    documents: Array<{kind: LegalDocumentKind; version: string}>,
  ): Promise<OnboardingStatus>;
  signOut(): Promise<void>;
  startAutoRefresh(): void;
  stopAutoRefresh(): void;
  subscribe(listener: (session: Session | null) => void): () => void;
}

type Operation = 'sign-in' | 'session' | 'rpc';

const invalidSessionCodes = new Set([
  'bad_jwt',
  'invalid_jwt',
  'refresh_token_already_used',
  'refresh_token_not_found',
  'session_expired',
  'session_not_found',
]);

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const candidate = Reflect.get(value, property);
  return typeof candidate === 'string' ? candidate : undefined;
}

function isTransportError(
  error: unknown,
  operation: Operation,
  status?: number,
): boolean {
  if (status === 0) {
    return true;
  }

  if (isAuthRetryableFetchError(error) && error.status === 0) {
    return true;
  }

  if (operation === 'rpc') {
    return false;
  }

  const name = readStringProperty(error, 'name');
  return name === 'TypeError' || name === 'AbortError';
}

function isInvalidSessionError(error: unknown, status?: number): boolean {
  if (status === 401 || isAuthSessionMissingError(error)) {
    return true;
  }

  const code = isAuthError(error)
    ? error.code
    : readStringProperty(error, 'code');

  return code !== undefined
    && (invalidSessionCodes.has(code) || code === 'PGRST301');
}

function repositoryError(
  error: unknown,
  operation: Operation,
  status?: number,
): AuthRepositoryError {
  if (error instanceof AuthRepositoryError) {
    return error;
  }

  if (isTransportError(error, operation, status)) {
    return new AuthRepositoryError('network', {cause: error});
  }

  if (operation !== 'sign-in' && isInvalidSessionError(error, status)) {
    return new AuthRepositoryError('invalid-session', {cause: error});
  }

  return new AuthRepositoryError('server', {cause: error});
}

function invalidSession(cause?: unknown): AuthRepositoryError {
  return new AuthRepositoryError('invalid-session', {cause});
}

function publicPasswordSignInError(
  error: unknown,
  status?: number,
): AuthRepositoryError {
  const mapped = repositoryError(error, 'sign-in', status);
  return new AuthRepositoryError(mapped.kind);
}

export function createAuthRepository(
  client: SupabaseClient<Database>,
): AuthRepository {
  return {
    async signInWithIdToken(input) {
      try {
        const result = await client.auth.signInWithIdToken(input);

        if (result.error !== null) {
          throw repositoryError(result.error, 'sign-in');
        }

        if (result.data.session === null) {
          throw new AuthRepositoryError('server');
        }

        return result.data.session;
      } catch (error) {
        throw repositoryError(error, 'sign-in');
      }
    },

    async signInWithPassword(input) {
      try {
        const result = await client.auth.signInWithPassword(input);

        if (result.error !== null) {
          throw repositoryError(result.error, 'sign-in', result.error.status);
        }

        if (!result.data.session) {
          throw new AuthRepositoryError('server');
        }

        return result.data.session;
      } catch (error) {
        throw publicPasswordSignInError(error);
      }
    },

    async getStoredSessionEvidence() {
      try {
        const result = await client.auth.getSession();

        if (result.error !== null) {
          throw repositoryError(result.error, 'session');
        }

        const session = result.data.session;

        if (session === null) {
          return undefined;
        }

        const userId = session.user.id;
        const expiresAt = session.expires_at;

        if (
          typeof userId !== 'string'
          || userId.length === 0
          || typeof expiresAt !== 'number'
          || !Number.isInteger(expiresAt)
          || expiresAt <= 0
        ) {
          return undefined;
        }

        return {session, userId, expiresAt};
      } catch (error) {
        throw repositoryError(error, 'session');
      }
    },

    async verifyClaims(accessToken) {
      try {
        const result = await client.auth.getClaims(accessToken);

        if (result.error !== null) {
          throw repositoryError(result.error, 'session');
        }

        const subject = result.data?.claims.sub;
        const expiresAt = result.data?.claims.exp;

        if (
          typeof subject !== 'string'
          || subject.length === 0
          || typeof expiresAt !== 'number'
          || !Number.isInteger(expiresAt)
          || expiresAt <= Math.floor(Date.now() / 1000)
        ) {
          throw invalidSession();
        }

        return {userId: subject, expiresAt};
      } catch (error) {
        throw repositoryError(error, 'session');
      }
    },

    async verifySessionWithServer(accessToken) {
      try {
        const result = await client.auth.getUser(accessToken);

        if (result.error !== null) {
          throw repositoryError(result.error, 'session');
        }

        const userId = result.data.user?.id;

        if (typeof userId !== 'string' || userId.length === 0) {
          throw invalidSession();
        }

        return {userId};
      } catch (error) {
        throw repositoryError(error, 'session');
      }
    },

    async getOnboardingStatus() {
      try {
        const result = await client.rpc('get_onboarding_status');

        if (result.error !== null) {
          throw repositoryError(result.error, 'rpc', result.status);
        }

        return parseOnboardingStatus(result.data);
      } catch (error) {
        throw repositoryError(error, 'rpc');
      }
    },

    async completeOnboarding(documents) {
      try {
        const result = await client.rpc('complete_onboarding', {
          requested_documents: documents,
        });

        if (result.error !== null) {
          throw repositoryError(result.error, 'rpc', result.status);
        }

        return parseOnboardingStatus(result.data);
      } catch (error) {
        throw repositoryError(error, 'rpc');
      }
    },

    async signOut() {
      try {
        const result = await client.auth.signOut({scope: 'local'});

        if (result.error !== null) {
          throw repositoryError(result.error, 'session');
        }
      } catch (error) {
        throw repositoryError(error, 'session');
      }
    },

    startAutoRefresh() {
      void client.auth.startAutoRefresh().catch(() => undefined);
    },

    stopAutoRefresh() {
      void client.auth.stopAutoRefresh().catch(() => undefined);
    },

    subscribe(listener) {
      const {data} = client.auth.onAuthStateChange((_event, session) => {
        listener(session);
      });

      return () => data.subscription.unsubscribe();
    },
  };
}
