import assert from 'node:assert/strict';
import test from 'node:test';

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
      'insert into public.legal_documents (kind, version, effective_at, document_url)',
      'values',
      `  ('terms', '${STAGING_LEGAL_VERSION}', '2026-07-18T00:00:00.000Z', '${urls.terms}'),`,
      `  ('privacy', '${STAGING_LEGAL_VERSION}', '2026-07-18T00:00:00.000Z', '${urls.privacy}')`,
      'on conflict (kind, version) do nothing;',
      '',
      'insert into public.current_legal_documents (kind, document_version)',
      'values',
      `  ('terms', '${STAGING_LEGAL_VERSION}'),`,
      `  ('privacy', '${STAGING_LEGAL_VERSION}')`,
      'on conflict (kind) do update',
      'set document_version = excluded.document_version;',
      '',
    ].join('\n'),
  );
});

test('rejects legal URLs built from an invalid commit', () => {
  assert.throws(() => buildStagingLegalUrls('ABCDEF'), /40 lowercase hex/i);
  assert.throws(() => buildStagingLegalSql(`${commitSha}x`), /40 lowercase hex/i);
});

test('requires both reachable HTTPS legal documents to contain the exact version marker', async () => {
  const urls = buildStagingLegalUrls(commitSha);
  const requestedUrls = [];

  await assert.doesNotReject(
    assertStagingLegalDocumentsReachable({
      commitSha,
      fetchImpl: async url => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          async text() {
            return `# staging\n\nVersion: ${STAGING_LEGAL_VERSION}\n`;
          },
        };
      },
    }),
  );

  assert.deepEqual(requestedUrls, [urls.terms, urls.privacy]);

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
