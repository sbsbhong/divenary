import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type Session,
} from '@supabase/supabase-js';

import {
  AuthRepositoryError,
  createAuthRepository,
} from './auth-repository.ts';
import {parseOnboardingStatus} from './onboarding-status.ts';
import type {Json} from './database.types.ts';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000002';
const FUTURE_EXPIRY = Math.floor(Date.now() / 1000) + 3_600;

const termsDocument = {
  kind: 'terms',
  version: '2026-07-13',
  effectiveAt: '2026-07-13T00:00:00+00:00',
  documentUrl: 'https://legal.diving-app.invalid/terms/2026-07-13',
} satisfies Json;
const privacyDocument = {
  kind: 'privacy',
  version: '2026-07-13',
  effectiveAt: '2026-07-13T00:00:00Z',
  documentUrl: 'https://legal.diving-app.invalid/privacy/2026-07-13',
} satisfies Json;
const requiredDocuments = [termsDocument, privacyDocument] satisfies Json[];

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'access-token',
    expires_at: FUTURE_EXPIRY,
    expires_in: 3_600,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    user: {
      id: USER_ID,
      app_metadata: {},
      aud: 'authenticated',
      created_at: '2026-07-13T00:00:00Z',
      user_metadata: {},
    },
    ...overrides,
  };
}

function statusJson(overrides: Record<string, Json | undefined> = {}): Json {
  return {
    isComplete: false,
    onboardingCompletedAt: null,
    requiredDocuments,
    acceptedDocuments: [],
    ...overrides,
  };
}

type RepositoryClient = Parameters<typeof createAuthRepository>[0];

type MockOptions = {
  session?: Session | null;
  sessionError?: unknown;
  signInSession?: Session | null;
  signInError?: unknown;
  signInThrows?: unknown;
  passwordSignInSession?: Session | null;
  passwordSignInSessionUndefined?: boolean;
  passwordSignInError?: unknown;
  passwordSignInThrows?: unknown;
  claimsData?: {claims: Record<string, unknown>} | null;
  claimsError?: unknown;
  userId?: string | null;
  userError?: unknown;
  statusData?: Json | null;
  statusError?: unknown;
  statusHttpStatus?: number;
  completionData?: Json | null;
  completionError?: unknown;
  completionHttpStatus?: number;
  signOutError?: unknown;
};

function createClientMock(options: MockOptions = {}) {
  const calls = {
    signIn: [] as unknown[],
    signInWithPassword: [] as unknown[],
    getSession: 0,
    getClaims: [] as string[],
    getUser: [] as string[],
    rpc: [] as Array<{name: string; args: unknown}>,
    signOut: [] as unknown[],
    startAutoRefresh: 0,
    stopAutoRefresh: 0,
    unsubscribe: 0,
    listener: undefined as ((event: string, session: Session | null) => void) | undefined,
  };

  const client = {
    auth: {
      async signInWithIdToken(input: unknown) {
        calls.signIn.push(input);
        if (options.signInThrows !== undefined) {
          throw options.signInThrows;
        }

        return {
          data: {
            session: options.signInSession === undefined
              ? createSession()
              : options.signInSession,
            user: null,
          },
          error: options.signInError ?? null,
        };
      },
      async signInWithPassword(input: unknown) {
        calls.signInWithPassword.push(input);
        if (options.passwordSignInThrows !== undefined) {
          throw options.passwordSignInThrows;
        }

        return {
          data: {
            session: options.passwordSignInSessionUndefined
              ? undefined
              : options.passwordSignInSession === undefined
              ? createSession()
              : options.passwordSignInSession,
            user: null,
          },
          error: options.passwordSignInError ?? null,
        };
      },
      async getSession() {
        calls.getSession += 1;
        return {
          data: {
            session: options.session === undefined
              ? createSession()
              : options.session,
          },
          error: options.sessionError ?? null,
        };
      },
      async getClaims(accessToken: string) {
        calls.getClaims.push(accessToken);
        return {
          data: options.claimsData === undefined
            ? {
                claims: {
                  sub: USER_ID,
                  exp: FUTURE_EXPIRY,
                },
              }
            : options.claimsData,
          error: options.claimsError ?? null,
        };
      },
      async getUser(accessToken: string) {
        calls.getUser.push(accessToken);
        return {
          data: {
            user: options.userId === null
              ? null
              : {
                  id: options.userId ?? USER_ID,
                  app_metadata: {},
                  aud: 'authenticated',
                  created_at: '2026-07-13T00:00:00Z',
                  user_metadata: {},
                },
          },
          error: options.userError ?? null,
        };
      },
      async signOut(input: unknown) {
        calls.signOut.push(input);
        return {error: options.signOutError ?? null};
      },
      startAutoRefresh() {
        calls.startAutoRefresh += 1;
        return Promise.resolve();
      },
      stopAutoRefresh() {
        calls.stopAutoRefresh += 1;
        return Promise.resolve();
      },
      onAuthStateChange(
        listener: (event: string, session: Session | null) => void,
      ) {
        calls.listener = listener;
        return {
          data: {
            subscription: {
              id: 'subscription',
              unsubscribe() {
                calls.unsubscribe += 1;
              },
            },
          },
        };
      },
    },
    async rpc(name: string, args?: unknown) {
      calls.rpc.push({name, args});

      if (name === 'get_onboarding_status') {
        return {
          data: options.statusData === undefined
            ? statusJson()
            : options.statusData,
          error: options.statusError ?? null,
          status: options.statusHttpStatus ?? 200,
        };
      }

      return {
        data: options.completionData === undefined
          ? statusJson({
              isComplete: true,
              onboardingCompletedAt: '2026-07-13T01:00:00Z',
              acceptedDocuments: [
                {kind: 'terms', version: '2026-07-13'},
                {kind: 'privacy', version: '2026-07-13'},
              ],
            })
          : options.completionData,
        error: options.completionError ?? null,
        status: options.completionHttpStatus ?? 200,
      };
    },
  };

  return {
    client: client as unknown as RepositoryClient,
    calls,
  };
}

async function expectRepositoryError(
  operation: () => Promise<unknown>,
  kind: 'network' | 'invalid-session' | 'server',
) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof AuthRepositoryError);
    assert.equal(error.kind, kind);
    assert.equal(error.message, 'Authentication operation failed');
    return true;
  });
}

function assertSanitizedSignInError(
  error: unknown,
  expected: {
    kind: 'network' | 'server';
    code?: string;
    status?: number;
  },
  forbiddenValues: string[],
) {
  assert.ok(error instanceof AuthRepositoryError);
  assert.deepEqual(
    {
      name: error.name,
      message: error.message,
      kind: error.kind,
      operation: error.operation,
      code: error.code,
      status: error.status,
    },
    {
      name: 'AuthRepositoryError',
      message: 'Authentication operation failed',
      kind: expected.kind,
      operation: 'sign-in',
      code: expected.code,
      status: expected.status,
    },
  );
  assert.equal(Reflect.has(error, 'cause'), false);

  const publicError = JSON.stringify({
    name: error.name,
    message: error.message,
    kind: error.kind,
    operation: error.operation,
    code: error.code,
    status: error.status,
    stack: error.stack,
  });
  for (const value of forbiddenValues) {
    assert.equal(publicError.includes(value), false);
  }
}

describe('AuthRepository', () => {
  test('exchanges a Google ID token without a nonce', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);

    const session = await repository.signInWithIdToken({
      provider: 'google',
      token: 'google-id-token',
    });

    assert.equal(session.user.id, USER_ID);
    assert.deepEqual(calls.signIn, [
      {provider: 'google', token: 'google-id-token'},
    ]);
  });

  test('exchanges an Apple ID token with its raw nonce', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);

    await repository.signInWithIdToken({
      provider: 'apple',
      token: 'apple-id-token',
      nonce: 'raw-apple-nonce',
    });

    assert.deepEqual(calls.signIn, [
      {
        provider: 'apple',
        token: 'apple-id-token',
        nonce: 'raw-apple-nonce',
      },
    ]);
  });

  test('maps provider transport failure without exposing the raw cause or Google credential', async () => {
    const idToken = 'google-transport-id-token';
    const providerEmail = 'google-transport@example.invalid';
    const {client} = createClientMock({
      signInThrows: new AuthRetryableFetchError(
        `${idToken} and ${providerEmail} must not leak`,
        0,
      ),
    });
    const repository = createAuthRepository(client);

    await assert.rejects(
      () =>
        repository.signInWithIdToken({
        provider: 'google',
          token: idToken,
      }),
      error => {
        assertSanitizedSignInError(
          error,
          {kind: 'network', status: 0},
          [idToken, providerEmail],
        );
        return true;
      },
    );
  });

  test('sanitizes an Apple token-exchange Auth error while preserving safe metadata', async () => {
    const idToken = 'apple-rejected-id-token';
    const nonce = 'apple-raw-nonce';
    const providerEmail = 'apple-provider@example.invalid';
    const {client} = createClientMock({
      signInError: new AuthApiError(
        `${idToken}, ${nonce}, and ${providerEmail} must not leak`,
        401,
        'bad_jwt',
      ),
      signInSession: null,
    });
    const repository = createAuthRepository(client);

    await assert.rejects(
      () => repository.signInWithIdToken({
        provider: 'apple',
        token: idToken,
        nonce,
      }),
      error => {
        assertSanitizedSignInError(
          error,
          {kind: 'server', code: 'bad_jwt', status: 401},
          [idToken, nonce, providerEmail],
        );
        return true;
      },
    );
  });

  test('exchanges an email and password and returns the session', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);

    const session = await repository.signInWithPassword({
      email: 'diver@example.invalid',
      password: 'local-password',
    });

    assert.equal(session.user.id, USER_ID);
    assert.deepEqual(calls.signInWithPassword, [{
      email: 'diver@example.invalid',
      password: 'local-password',
    }]);
  });

  test('maps a missing password session to a generic server error', async () => {
    const {client} = createClientMock({passwordSignInSession: null});
    const repository = createAuthRepository(client);

    await assert.rejects(
      () => repository.signInWithPassword({
        email: 'diver@example.invalid',
        password: 'local-password',
      }),
      error => {
        assert.ok(error instanceof AuthRepositoryError);
        assert.equal(error.kind, 'server');
        assert.equal(error.message, 'Authentication operation failed');
        assert.doesNotMatch(error.message, /diver@example\.invalid|local-password/);
        return true;
      },
    );
  });

  test('maps a password Auth error to a generic server error without credentials', async () => {
    const {client} = createClientMock({
      passwordSignInSession: null,
      passwordSignInError: new AuthApiError(
        'Invalid credentials for diver@example.invalid with local-password',
        401,
        'invalid_credentials',
      ),
    });
    const repository = createAuthRepository(client);

    await assert.rejects(
      () => repository.signInWithPassword({
        email: 'diver@example.invalid',
        password: 'local-password',
      }),
      error => {
        assertSanitizedSignInError(
          error,
          {kind: 'server', code: 'invalid_credentials', status: 401},
          ['diver@example.invalid', 'local-password'],
        );
        return true;
      },
    );
  });

  test('maps an undefined password session to a generic server error', async () => {
    const {client} = createClientMock({passwordSignInSessionUndefined: true});
    const repository = createAuthRepository(client);

    await expectRepositoryError(
      () => repository.signInWithPassword({
        email: 'diver@example.invalid',
        password: 'local-password',
      }),
      'server',
    );
  });

  test('maps a password transport failure to a generic network error without credentials', async () => {
    const {client} = createClientMock({
      passwordSignInThrows: new AuthRetryableFetchError(
        'request for diver@example.invalid with local-password failed',
        0,
      ),
    });
    const repository = createAuthRepository(client);

    await assert.rejects(
      () => repository.signInWithPassword({
        email: 'diver@example.invalid',
        password: 'local-password',
      }),
      error => {
        assertSanitizedSignInError(
          error,
          {kind: 'network', status: 0},
          ['diver@example.invalid', 'local-password'],
        );
        return true;
      },
    );
  });

  test('returns bounded stored session evidence without treating it as online proof', async () => {
    const session = createSession();
    const {client, calls} = createClientMock({session});
    const repository = createAuthRepository(client);

    const evidence = await repository.getStoredSessionEvidence();

    assert.equal(calls.getSession, 1);
    assert.deepEqual(evidence, {
      session,
      userId: USER_ID,
      expiresAt: FUTURE_EXPIRY,
    });
  });

  test('returns no stored evidence for a missing or incomplete session', async () => {
    const missing = createAuthRepository(createClientMock({session: null}).client);
    assert.equal(await missing.getStoredSessionEvidence(), undefined);

    const noExpirySession = createSession();
    delete noExpirySession.expires_at;
    const incomplete = createAuthRepository(
      createClientMock({session: noExpirySession}).client,
    );
    assert.equal(await incomplete.getStoredSessionEvidence(), undefined);
  });

  test('verifies claims for the supplied token and returns subject plus expiry', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);

    const claims = await repository.verifyClaims('claims-access-token');

    assert.deepEqual(calls.getClaims, ['claims-access-token']);
    assert.deepEqual(claims, {userId: USER_ID, expiresAt: FUTURE_EXPIRY});
  });

  test('rejects malformed or expired verified claims', async () => {
    const malformed = createAuthRepository(
      createClientMock({
        claimsData: {claims: {sub: '', exp: FUTURE_EXPIRY}},
      }).client,
    );
    await expectRepositoryError(
      () => malformed.verifyClaims('access-token'),
      'invalid-session',
    );

    const expired = createAuthRepository(
      createClientMock({
        claimsData: {
          claims: {sub: OTHER_USER_ID, exp: Math.floor(Date.now() / 1000) - 1},
        },
      }).client,
    );
    await expectRepositoryError(
      () => expired.verifyClaims('access-token'),
      'invalid-session',
    );
  });

  test('does not classify a claims JWKS transport failure as invalid token', async () => {
    const {client} = createClientMock({
      claimsData: null,
      claimsError: new AuthRetryableFetchError('JWKS unavailable', 0),
    });
    const repository = createAuthRepository(client);

    await expectRepositoryError(
      () => repository.verifyClaims('access-token'),
      'network',
    );
  });

  test('validates the supplied token with the Auth server', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);

    const result = await repository.verifySessionWithServer('server-token');

    assert.deepEqual(calls.getUser, ['server-token']);
    assert.deepEqual(result, {userId: USER_ID});
  });

  test('maps server session rejection to invalid-session', async () => {
    const {client} = createClientMock({
      userId: null,
      userError: new AuthSessionMissingError(),
    });
    const repository = createAuthRepository(client);

    await expectRepositoryError(
      () => repository.verifySessionWithServer('expired-token'),
      'invalid-session',
    );
  });

  test('calls the user-id-free status RPC and parses its Json result', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);

    const status = await repository.getOnboardingStatus();

    assert.equal(status.isComplete, false);
    assert.deepEqual(calls.rpc, [
      {name: 'get_onboarding_status', args: undefined},
    ]);
  });

  test('sends only the selected exact document pairs to completion RPC', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);
    const documents = [
      {kind: 'terms' as const, version: '2026-07-13'},
      {kind: 'privacy' as const, version: '2026-07-13'},
    ];

    const status = await repository.completeOnboarding(documents);

    assert.equal(status.isComplete, true);
    assert.deepEqual(calls.rpc, [
      {
        name: 'complete_onboarding',
        args: {requested_documents: documents},
      },
    ]);
  });

  test('maps Data API transport, auth, malformed payload, and server failures', async () => {
    const transport = createAuthRepository(
      createClientMock({
        statusData: null,
        statusError: {code: '', details: '', hint: '', message: 'fetch failed'},
        statusHttpStatus: 0,
      }).client,
    );
    await expectRepositoryError(
      () => transport.getOnboardingStatus(),
      'network',
    );

    const auth = createAuthRepository(
      createClientMock({
        statusData: null,
        statusError: {code: 'PGRST301', details: '', hint: '', message: 'bad jwt'},
        statusHttpStatus: 401,
      }).client,
    );
    await expectRepositoryError(
      () => auth.getOnboardingStatus(),
      'invalid-session',
    );

    const malformed = createAuthRepository(
      createClientMock({statusData: {isComplete: 'yes'}}).client,
    );
    await expectRepositoryError(
      () => malformed.getOnboardingStatus(),
      'server',
    );

    const server = createAuthRepository(
      createClientMock({
        completionData: null,
        completionError: {
          code: 'XX000',
          details: '',
          hint: '',
          message: 'private server detail',
        },
        completionHttpStatus: 500,
      }).client,
    );
    await expectRepositoryError(
      () => server.completeOnboarding([
        {kind: 'terms', version: '2026-07-13'},
        {kind: 'privacy', version: '2026-07-13'},
      ]),
      'server',
    );
  });

  test('signs out locally, forwards session changes, and controls refresh lifecycle', async () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);
    const observed: Array<Session | null> = [];
    const unsubscribe = repository.subscribe(session => observed.push(session));

    calls.listener?.('SIGNED_IN', createSession());
    calls.listener?.('SIGNED_OUT', null);
    repository.startAutoRefresh();
    repository.stopAutoRefresh();
    await repository.signOut();
    unsubscribe();

    assert.deepEqual(observed.map(session => session?.user.id ?? null), [
      USER_ID,
      null,
    ]);
    assert.equal(calls.startAutoRefresh, 1);
    assert.equal(calls.stopAutoRefresh, 1);
    assert.deepEqual(calls.signOut, [{scope: 'local'}]);
    assert.equal(calls.unsubscribe, 1);
  });

  test('forwards the auth event with each session change', () => {
    const {client, calls} = createClientMock();
    const repository = createAuthRepository(client);
    const observed: Array<[string | null, string]> = [];
    repository.subscribe((session, event) =>
      observed.push([session?.user.id ?? null, event]),
    );

    calls.listener?.('INITIAL_SESSION', null);
    calls.listener?.('TOKEN_REFRESHED', createSession());
    calls.listener?.('SIGNED_OUT', null);

    assert.deepEqual(observed, [
      [null, 'INITIAL_SESSION'],
      [USER_ID, 'TOKEN_REFRESHED'],
      [null, 'SIGNED_OUT'],
    ]);
  });
});

describe('parseOnboardingStatus', () => {
  test('parses pending, complete, and re-consent states into canonical order', () => {
    const pending = parseOnboardingStatus(statusJson());
    assert.equal(pending.isComplete, false);
    assert.deepEqual(pending.acceptedDocuments, []);

    const complete = parseOnboardingStatus(statusJson({
      isComplete: true,
      onboardingCompletedAt: '2026-07-13T01:00:00Z',
      requiredDocuments: [...requiredDocuments].reverse(),
      acceptedDocuments: [
        {kind: 'privacy', version: '2026-07-13'},
        {kind: 'terms', version: '2026-07-13'},
      ],
    }));
    assert.deepEqual(complete.requiredDocuments.map(item => item.kind), [
      'terms',
      'privacy',
    ]);
    assert.deepEqual(complete.acceptedDocuments.map(item => item.kind), [
      'terms',
      'privacy',
    ]);

    const reconsent = parseOnboardingStatus(statusJson({
      onboardingCompletedAt: '2026-07-13T01:00:00+09:00',
      acceptedDocuments: [{kind: 'privacy', version: '2026-07-13'}],
    }));
    assert.equal(reconsent.isComplete, false);
    assert.equal(reconsent.onboardingCompletedAt, '2026-07-13T01:00:00+09:00');
  });

  test('rejects malformed top-level values and scalar fields', () => {
    const invalidValues: unknown[] = [
      null,
      [],
      true,
      'status',
      statusJson({isComplete: 'false'}),
      statusJson({onboardingCompletedAt: 123}),
      statusJson({onboardingCompletedAt: 'not-a-date'}),
      statusJson({onboardingCompletedAt: '2026-02-30T00:00:00Z'}),
    ];

    for (const value of invalidValues) {
      assert.throws(
        () => parseOnboardingStatus(value as Json),
        /Invalid onboarding status response/,
      );
    }
  });

  test('requires exactly one valid terms and privacy document', () => {
    const terms = termsDocument;
    const privacy = privacyDocument;
    const invalidRequired: Json[] = [
      [terms],
      [terms, privacy, privacy],
      [terms, {...terms}],
      [terms, {...privacy, kind: 'marketing'}],
      [{...terms, version: ''}, privacy],
      [{...terms, effectiveAt: '2026-13-01T00:00:00Z'}, privacy],
      [{...terms, documentUrl: 'http://example.com/terms'}, privacy],
      [{...terms, documentUrl: '/terms'}, privacy],
      [{...terms, documentUrl: 'https://user:pass@example.com/terms'}, privacy],
    ];

    for (const required of invalidRequired) {
      assert.throws(
        () => parseOnboardingStatus(statusJson({requiredDocuments: required})),
        /Invalid onboarding status response/,
      );
    }
  });

  test('requires unique accepted pairs matching the current required versions', () => {
    const invalidAccepted: Json[] = [
      'not-an-array',
      [{kind: 'terms', version: '2026-07-13'}, {kind: 'terms', version: '2026-07-13'}],
      [{kind: 'terms', version: 'stale'}],
      [{kind: 'marketing', version: '2026-07-13'}],
      [{kind: 'privacy', version: ''}],
    ];

    for (const accepted of invalidAccepted) {
      assert.throws(
        () => parseOnboardingStatus(statusJson({acceptedDocuments: accepted})),
        /Invalid onboarding status response/,
      );
    }
  });

  test('rejects status combinations inconsistent with the server completion rule', () => {
    const acceptedTerms = {kind: 'terms', version: '2026-07-13'} satisfies Json;
    const acceptedPrivacy = {
      kind: 'privacy',
      version: '2026-07-13',
    } satisfies Json;
    const allAccepted = [acceptedTerms, acceptedPrivacy] satisfies Json[];
    const invalidStates = [
      statusJson({isComplete: true}),
      statusJson({
        isComplete: true,
        onboardingCompletedAt: '2026-07-13T01:00:00Z',
        acceptedDocuments: [acceptedTerms],
      }),
      statusJson({
        isComplete: false,
        onboardingCompletedAt: '2026-07-13T01:00:00Z',
        acceptedDocuments: allAccepted,
      }),
    ];

    for (const value of invalidStates) {
      assert.throws(
        () => parseOnboardingStatus(value),
        /Invalid onboarding status response/,
      );
    }
  });
});
