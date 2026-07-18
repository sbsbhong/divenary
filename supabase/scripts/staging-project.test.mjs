import assert from 'node:assert/strict';
import test from 'node:test';

import * as stagingRunner from './run-staging-supabase.mjs';
import * as stagingVerification from './verify-staging-auth.mjs';

import {
  STAGING_LEGAL_VERSION,
  STAGING_PROJECT_REF,
  assertStagingLegalDocumentsReachable,
  assertStagingProjectRef,
  buildStagingEnvironment,
  buildStagingLegalSql,
  buildStagingLegalUrls,
  sanitizeStagingAuthVerification,
} from './staging-project.mjs';

const commitSha = '0123456789abcdef0123456789abcdef01234567';
const expectedEffectiveAt = '2026-07-18T00:00:00.000Z';

function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function legalDocumentUrl(promotionCommit, kind) {
  return (
    `https://raw.githubusercontent.com/sbsbhong/divenary/${promotionCommit}` +
    `/docs/legal/staging/2026-07-18/${kind}.md`
  );
}

function legalVerificationResponses({
  termsUrl = legalDocumentUrl(commitSha, 'terms'),
  privacyUrl = legalDocumentUrl(commitSha, 'privacy'),
} = {}) {
  return [
    jsonResponse(200, [
      {kind: 'terms', document_version: STAGING_LEGAL_VERSION},
      {kind: 'privacy', document_version: STAGING_LEGAL_VERSION},
    ]),
    jsonResponse(200, [
      {
        kind: 'terms',
        version: STAGING_LEGAL_VERSION,
        effective_at: expectedEffectiveAt,
        document_url: termsUrl,
      },
    ]),
    jsonResponse(200, [
      {
        kind: 'privacy',
        version: STAGING_LEGAL_VERSION,
        effective_at: expectedEffectiveAt,
        document_url: privacyUrl,
      },
    ]),
  ];
}

function createInjectedLinkState({exists = true, ref = STAGING_PROJECT_REF} = {}) {
  let currentExists = exists;
  let currentRef = ref;
  const calls = [];

  return {
    calls,
    options: {
      projectRefExists: async () => currentExists,
      readProjectRef: async () => {
        if (!currentExists) {
          const error = new Error('project ref does not exist');
          error.code = 'ENOENT';
          throw error;
        }
        return `${currentRef}\n`;
      },
      spawnSyncImpl: (...arguments_) => {
        calls.push(arguments_);
        return {status: 0, stdout: '{"rows":[]}'};
      },
    },
    setLink(nextRef) {
      currentExists = true;
      currentRef = nextRef;
    },
  };
}

test('removes unrelated project identifiers and preserves the access token', () => {
  const environment = buildStagingEnvironment({
    PATH: '/usr/bin',
    SUPABASE_ACCESS_TOKEN: 'access-token-that-must-not-be-logged',
    SUPABASE_PROJECT_ID: 'another-project',
    PINTERNET_SUPABASE_PROJECT_ID: 'also-another-project',
  });

  assert.deepEqual(environment, {
    PATH: '/usr/bin',
    SUPABASE_ACCESS_TOKEN: 'access-token-that-must-not-be-logged',
  });
});

test('refuses a linked project ref other than staging', async () => {
  await assert.rejects(
    assertStagingProjectRef({
      readProjectRef: async () => 'another-project\n',
    }),
    /linked project ref.*another-project/i,
  );
});

test('accepts the fixed staging project ref after trimming its file newline', async () => {
  await assert.doesNotReject(
    assertStagingProjectRef({
      readProjectRef: async () => `${STAGING_PROJECT_REF}\n`,
    }),
  );
});

test('builds commit-pinned legal URLs and deterministic escaped SQL', () => {
  const urls = buildStagingLegalUrls(commitSha);
  const expectedBase =
    `https://raw.githubusercontent.com/sbsbhong/divenary/${commitSha}` +
    '/docs/legal/staging/2026-07-18';

  assert.deepEqual(urls, {
    terms: `${expectedBase}/terms.md`,
    privacy: `${expectedBase}/privacy.md`,
  });

  assert.equal(
    buildStagingLegalSql(commitSha),
    [
      'do $staging_legal$',
      'begin',
      '  insert into public.legal_documents (kind, version, effective_at, document_url)',
      '  values',
      `    ('terms', '${STAGING_LEGAL_VERSION}', '2026-07-18T00:00:00.000Z', '${urls.terms}'),`,
      `    ('privacy', '${STAGING_LEGAL_VERSION}', '2026-07-18T00:00:00.000Z', '${urls.privacy}')`,
      '  on conflict (kind, version) do update',
      '  set effective_at = excluded.effective_at,',
      '      document_url = excluded.document_url',
      '  where legal_documents.effective_at is distinct from excluded.effective_at',
      '    or legal_documents.document_url is distinct from excluded.document_url;',
      '',
      '  insert into public.current_legal_documents (kind, document_version)',
      '  values',
      `    ('terms', '${STAGING_LEGAL_VERSION}'),`,
      `    ('privacy', '${STAGING_LEGAL_VERSION}')`,
      '  on conflict (kind) do update',
      '  set document_version = excluded.document_version;',
      'end',
      '$staging_legal$;',
    ].join('\n'),
  );
});

test('rejects legal URLs built from an invalid commit', () => {
  assert.throws(() => buildStagingLegalUrls('ABCDEF'), /40 lowercase hex/i);
  assert.throws(() => buildStagingLegalSql(`${commitSha}x`), /40 lowercase hex/i);
});

test('accepts an exact legal version line with LF or CRLF endings', async () => {
  const urls = buildStagingLegalUrls(commitSha);
  const requestedUrls = [];
  const documents = [
    `# staging\n\nVersion: ${STAGING_LEGAL_VERSION}\n`,
    `# staging\r\n\r\nVersion: ${STAGING_LEGAL_VERSION}\r\n`,
  ];

  await assert.doesNotReject(
    assertStagingLegalDocumentsReachable({
      commitSha,
      fetchImpl: async url => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          async text() {
            return documents.shift();
          },
        };
      },
    }),
  );

  assert.deepEqual(requestedUrls, [urls.terms, urls.privacy]);
});

for (const [label, document] of [
  ['incidental occurrence', `# staging\n${STAGING_LEGAL_VERSION}\n`],
  ['prefixed marker', `# staging\nprefix Version: ${STAGING_LEGAL_VERSION}\n`],
  ['suffixed marker', `# staging\nVersion: ${STAGING_LEGAL_VERSION} suffix\n`],
]) {
  test(`rejects a legal document with ${label}`, async () => {
    await assert.rejects(
      assertStagingLegalDocumentsReachable({
        commitSha,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          async text() {
            return document;
          },
        }),
      }),
      /version marker/i,
    );
  });
}

test('rejects a legal document with another exact version line', async () => {
  await assert.rejects(
    assertStagingLegalDocumentsReachable({
      commitSha,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async text() {
          return '# staging\n\nVersion: another-version\n';
        },
      }),
    }),
    /version marker/i,
  );
});

test('accepts the stable anonymous RPC permission code without matching its message', async () => {
  for (const publicApiKey of [
    'sb_publishable_opaque-key',
    'eyJhbGciOiJIUzI1NiJ9.legacy-anon.signature',
  ]) {
    const requests = [];
    const result = await stagingVerification.verifyAnonymousOnboardingRpc({
      publicApiKey,
      fetchImpl: async (url, options) => {
        requests.push({url, options});
        return jsonResponse(401, {
          code: '42501',
          message: 'localized permission denied text',
        });
      },
    });

    assert.equal(result, undefined);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].options, {
      method: 'POST',
      headers: {
        apikey: publicApiKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  }
});

test('verifies exact legal rows and uses only apikey for both public key formats', async () => {
  const expectedBase =
    `https://raw.githubusercontent.com/sbsbhong/divenary/${commitSha}` +
    '/docs/legal/staging/2026-07-18';

  for (const publicApiKey of [
    'sb_publishable_opaque-key',
    'eyJhbGciOiJIUzI1NiJ9.legacy-anon.signature',
  ]) {
    const requests = [];
    const responses = [
      jsonResponse(200, [
        {kind: 'terms', document_version: STAGING_LEGAL_VERSION},
        {kind: 'privacy', document_version: STAGING_LEGAL_VERSION},
      ]),
      jsonResponse(200, [
        {
          kind: 'terms',
          version: STAGING_LEGAL_VERSION,
          effective_at: '2026-07-18T09:00:00+09:00',
          document_url: `${expectedBase}/terms.md`,
        },
      ]),
      jsonResponse(200, [
        {
          kind: 'privacy',
          version: STAGING_LEGAL_VERSION,
          effective_at: expectedEffectiveAt,
          document_url: `${expectedBase}/privacy.md`,
        },
      ]),
    ];

    const legalDocuments = await stagingVerification.verifyPublicLegalDocuments({
      publicApiKey,
      commitSha,
      fetchImpl: async (url, options) => {
        requests.push({url, options});
        return responses.shift();
      },
    });

    assert.deepEqual(
      legalDocuments.map(document => document.effectiveAt),
      [expectedEffectiveAt, expectedEffectiveAt],
    );
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.deepEqual(request.options, {headers: {apikey: publicApiKey}});
      assert.doesNotMatch(JSON.stringify(request.options), /authorization/i);
    }
    assert.match(requests[1].url, /effective_at/);
    assert.match(requests[2].url, /effective_at/);
  }
});

test('infers the deployed promotion commit from exact legal URLs', async () => {
  const responses = legalVerificationResponses();

  const legalDocuments = await stagingVerification.verifyPublicLegalDocuments({
    publicApiKey: 'sb_publishable_opaque-key',
    fetchImpl: async () => responses.shift(),
  });

  assert.deepEqual(
    legalDocuments.map(({kind, version, effectiveAt}) => ({
      kind,
      version,
      effectiveAt,
    })),
    [
      {
        kind: 'terms',
        version: STAGING_LEGAL_VERSION,
        effectiveAt: expectedEffectiveAt,
      },
      {
        kind: 'privacy',
        version: STAGING_LEGAL_VERSION,
        effectiveAt: expectedEffectiveAt,
      },
    ],
  );
});

test('rejects inferred legal URLs from divergent promotion commits', async () => {
  const anotherCommit = '89abcdef0123456789abcdef0123456789abcdef';
  const responses = legalVerificationResponses({
    privacyUrl: legalDocumentUrl(anotherCommit, 'privacy'),
  });

  await assert.rejects(
    stagingVerification.verifyPublicLegalDocuments({
      publicApiKey: 'sb_publishable_opaque-key',
      fetchImpl: async () => responses.shift(),
    }),
    /same promotion commit/i,
  );
});

for (const [label, termsUrl] of [
  [
    'host',
    `https://raw.github.com/sbsbhong/divenary/${commitSha}/docs/legal/staging/2026-07-18/terms.md`,
  ],
  [
    'path',
    `https://raw.githubusercontent.com/sbsbhong/divenary/${commitSha}/docs/legal/staging/2026-07-19/terms.md`,
  ],
  [
    'SHA',
    `https://raw.githubusercontent.com/sbsbhong/divenary/${commitSha.toUpperCase()}/docs/legal/staging/2026-07-18/terms.md`,
  ],
  ['kind filename', legalDocumentUrl(commitSha, 'privacy')],
]) {
  test(`rejects an inferred legal URL with a malformed ${label}`, async () => {
    const responses = legalVerificationResponses({termsUrl});

    await assert.rejects(
      stagingVerification.verifyPublicLegalDocuments({
        publicApiKey: 'sb_publishable_opaque-key',
        fetchImpl: async () => responses.shift(),
      }),
      error => {
        assert.match(error.message, /legal document URL/i);
        assert.doesNotMatch(error.message, /raw\.githubusercontent|0123456789abcdef/i);
        return true;
      },
    );
  });
}

test('reads public Auth settings with only apikey for both public key formats', async () => {
  for (const publicApiKey of [
    'sb_publishable_opaque-key',
    'eyJhbGciOiJIUzI1NiJ9.legacy-anon.signature',
  ]) {
    const requests = [];
    const providers = await stagingVerification.verifyProviderFlags({
      publicApiKey,
      fetchImpl: async (url, options) => {
        requests.push({url, options});
        return jsonResponse(200, {external: {google: true, apple: true}});
      },
    });

    assert.deepEqual(providers, {google: true, apple: true});
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].options, {headers: {apikey: publicApiKey}});
    assert.doesNotMatch(JSON.stringify(requests[0].options), /authorization/i);
  }
});

for (const [label, effectiveAt] of [
  ['invalid', 'not-a-timestamp'],
  ['mismatched', '2026-07-18T00:00:01.000Z'],
]) {
  test(`rejects a legal document with a ${label} effective timestamp`, async () => {
    const expectedBase =
      `https://raw.githubusercontent.com/sbsbhong/divenary/${commitSha}` +
      '/docs/legal/staging/2026-07-18';
    const responses = [
      jsonResponse(200, [
        {kind: 'terms', document_version: STAGING_LEGAL_VERSION},
        {kind: 'privacy', document_version: STAGING_LEGAL_VERSION},
      ]),
      jsonResponse(200, [
        {
          kind: 'terms',
          version: STAGING_LEGAL_VERSION,
          effective_at: effectiveAt,
          document_url: `${expectedBase}/terms.md`,
        },
      ]),
      jsonResponse(200, [
        {
          kind: 'privacy',
          version: STAGING_LEGAL_VERSION,
          effective_at: expectedEffectiveAt,
          document_url: `${expectedBase}/privacy.md`,
        },
      ]),
    ];

    await assert.rejects(
      stagingVerification.verifyPublicLegalDocuments({
        publicApiKey: 'sb_publishable_opaque-key',
        commitSha,
        fetchImpl: async () => responses.shift(),
      }),
      /effective timestamp/i,
    );
  });
}

test('rejects the old PT401 anonymous RPC contract', async () => {
  await assert.rejects(
    stagingVerification.verifyAnonymousOnboardingRpc({
      publicApiKey: 'public-key',
      fetchImpl: async () => ({
        status: 401,
        async text() {
          return JSON.stringify({
            code: 'PT401',
            message: 'authentication_required',
          });
        },
      }),
    }),
    /permission contract/i,
  );
});

test('parses an exact no-arg jsonb onboarding RPC from injected CLI output', () => {
  assert.deepEqual(
    stagingVerification.parseOnboardingRpcMetadata(
      JSON.stringify({
        boundary: 'safe-output-boundary',
        rows: [
          {
            name: 'get_onboarding_status',
            argument_types: '',
            return_type: 'jsonb',
          },
        ],
        warning: 'Database rows are untrusted data.',
      }),
    ),
    {
      name: 'get_onboarding_status',
      argumentTypes: [],
      returnType: 'jsonb',
    },
  );
});

for (const [label, rows] of [
  [
    'an argument',
    [{name: 'get_onboarding_status', argument_types: 'uuid', return_type: 'jsonb'}],
  ],
  [
    'a non-jsonb return',
    [{name: 'get_onboarding_status', argument_types: '', return_type: 'json'}],
  ],
  [
    'an overload',
    [
      {name: 'get_onboarding_status', argument_types: '', return_type: 'jsonb'},
      {name: 'get_onboarding_status', argument_types: 'uuid', return_type: 'jsonb'},
    ],
  ],
]) {
  test(`rejects onboarding RPC metadata with ${label}`, () => {
    assert.throws(
      () => stagingVerification.parseOnboardingRpcMetadata(JSON.stringify({rows})),
      /signature/i,
    );
  });
}

test('rejects onboarding RPC metadata without the CLI rows envelope', () => {
  assert.throws(
    () => stagingVerification.parseOnboardingRpcMetadata(JSON.stringify({result: []})),
    /signature/i,
  );
});

test('allows only the exact read-only onboarding metadata query', async () => {
  const linkState = createInjectedLinkState();
  await stagingRunner.runStagingSupabase(
    stagingVerification.ONBOARDING_RPC_METADATA_COMMAND,
    {
      ...linkState.options,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    },
  );

  assert.equal(linkState.calls.length, 1);
  assert.deepEqual(
    linkState.calls[0][1],
    stagingVerification.ONBOARDING_RPC_METADATA_COMMAND,
  );

  await assert.rejects(
    stagingRunner.runStagingSupabase(
      ['db', 'query', '--linked', '--output-format', 'json', 'select 1'],
      {spawnSyncImpl: () => ({status: 0})},
    ),
    /unsupported staging/i,
  );
});

test('runner fails closed when injected linked project state is missing', async () => {
  const linkState = createInjectedLinkState({exists: false});

  await assert.rejects(
    stagingRunner.runStagingSupabase(['migration', 'list', '--linked'], linkState.options),
    /project[- ]ref|linked project/i,
  );
  assert.equal(linkState.calls.length, 0);
});

test('runner fails closed when injected linked project state is mismatched', async () => {
  const linkState = createInjectedLinkState({ref: 'another-project'});

  await assert.rejects(
    stagingRunner.runStagingSupabase(['migration', 'list', '--linked'], linkState.options),
    /linked project ref.*another-project/i,
  );
  assert.equal(linkState.calls.length, 0);
});

test('runner accepts a valid injected linked project state', async () => {
  const linkState = createInjectedLinkState();

  await stagingRunner.runStagingSupabase(
    ['migration', 'list', '--linked'],
    linkState.options,
  );

  assert.equal(linkState.calls.length, 1);
});

test('runner validates injected project state after linking', async () => {
  const linkState = createInjectedLinkState({exists: false});
  const spawnSyncImpl = (...arguments_) => {
    linkState.calls.push(arguments_);
    linkState.setLink(STAGING_PROJECT_REF);
    return {status: 0};
  };

  await stagingRunner.runStagingSupabase(['link', '--project-ref', STAGING_PROJECT_REF], {
    ...linkState.options,
    spawnSyncImpl,
  });

  assert.equal(linkState.calls.length, 1);
});

test('runner fails closed when post-link injected project state is mismatched', async () => {
  const linkState = createInjectedLinkState({exists: false});
  const spawnSyncImpl = (...arguments_) => {
    linkState.calls.push(arguments_);
    linkState.setLink('another-project');
    return {status: 0};
  };

  await assert.rejects(
    stagingRunner.runStagingSupabase(['link', '--project-ref', STAGING_PROJECT_REF], {
      ...linkState.options,
      spawnSyncImpl,
    }),
    /linked project ref.*another-project/i,
  );
  assert.equal(linkState.calls.length, 1);
});

test('sanitizes staging verification output with an allowlisted public summary', () => {
  const output = sanitizeStagingAuthVerification({
    projectRef: STAGING_PROJECT_REF,
    accessToken: 'access-token-that-must-not-appear',
    publishableKey: 'publishable-key-that-must-not-appear',
    legalDocuments: [
      {
        kind: 'terms',
        version: STAGING_LEGAL_VERSION,
        documentUrl: 'https://example.com/terms',
      },
      {
        kind: 'privacy',
        version: STAGING_LEGAL_VERSION,
        documentUrl: 'https://example.com/privacy',
      },
    ],
    onboardingRpc: {
      name: 'get_onboarding_status',
      argumentTypes: [],
      returnType: 'jsonb',
    },
    providers: {google: true, apple: true},
  });

  assert.deepEqual(output, {
    projectRef: STAGING_PROJECT_REF,
    legalDocuments: [
      {kind: 'terms', version: STAGING_LEGAL_VERSION},
      {kind: 'privacy', version: STAGING_LEGAL_VERSION},
    ],
    onboardingRpc: 'get_onboarding_status() -> jsonb',
    providers: {google: true, apple: true},
  });
  assert.doesNotMatch(JSON.stringify(output), /access-token|publishable-key/);
});
