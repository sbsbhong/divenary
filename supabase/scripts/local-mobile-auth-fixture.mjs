import {randomBytes} from 'node:crypto';
import {rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const fixtureEmail = 'divenary-local@development.invalid';
const adminUserPageSize = 1000;
const maximumAdminUserPages = 1000;
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const defaultEnvPath = path.join(repositoryRoot, 'apps/mobile/.env.local');

function assertString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Local Supabase status is missing ${name}.`);
  }

  return value;
}

function createHeaders(apiKey, bearer = apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
  };
}

async function readResponse(response, label, expectedStatuses) {
  const text = await response.text();
  let body = null;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${label} failed with status ${response.status}.`);
  }

  return body;
}

function createAndroidUrl(apiUrl) {
  const url = new URL(apiUrl);

  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Local Supabase API URL must use localhost or 127.0.0.1.');
  }

  url.hostname = '10.0.2.2';
  return url.toString().replace(/\/$/, '');
}

function assertPendingOnboarding(status) {
  if (status?.isComplete !== false) {
    throw new Error('Local fixture user must have pending onboarding.');
  }

  const kinds = Array.isArray(status.requiredDocuments)
    ? status.requiredDocuments.map(document => document.kind)
    : [];
  const uniqueKinds = new Set(kinds);

  if (
    kinds.length !== 2 ||
    uniqueKinds.size !== 2 ||
    !uniqueKinds.has('terms') ||
    !uniqueKinds.has('privacy')
  ) {
    throw new Error(
      'Local fixture user must require exactly terms and privacy documents.',
    );
  }
}

function createEnvironment({apiUrl, androidUrl, publishableKey, password}) {
  return [
    `SUPABASE_URL=${apiUrl}`,
    `SUPABASE_ANDROID_URL=${androidUrl}`,
    `SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
    `LOCAL_AUTH_EMAIL=${fixtureEmail}`,
    `LOCAL_AUTH_PASSWORD=${password}`,
    '',
  ].join('\n');
}

async function listFixtureUserIds(fetchImpl, apiUrl, adminHeaders) {
  const userIds = new Set();

  for (let page = 1; page <= maximumAdminUserPages; page += 1) {
    const response = await fetchImpl(
      `${apiUrl}/auth/v1/admin/users?page=${page}&per_page=${adminUserPageSize}`,
      {method: 'GET', headers: adminHeaders},
    );
    const body = await readResponse(
      response,
      'list local fixture users',
      [200],
    );

    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Array.isArray(body.users) ||
      body.users.length > adminUserPageSize
    ) {
      throw new Error('Local fixture user list is invalid.');
    }

    for (const user of body.users) {
      if (
        user === null ||
        typeof user !== 'object' ||
        Array.isArray(user) ||
        typeof user.id !== 'string'
      ) {
        throw new Error('Local fixture user list is invalid.');
      }

      if (user.email === fixtureEmail) {
        userIds.add(user.id);
      }
    }

    if (body.users.length < adminUserPageSize) {
      return [...userIds];
    }
  }

  throw new Error('Local fixture user list exceeded the safe page limit.');
}

export async function prepareLocalMobileAuth(options) {
  const {
    readLocalStatus,
    fetchImpl = fetch,
    randomBytesImpl = randomBytes,
    writeFile: writeFileImpl = writeFile,
    rename: renameImpl = rename,
    envPath = defaultEnvPath,
    temporaryEnvPath = `${envPath}.${process.pid}.tmp`,
  } = options;
  const localStatus = await readLocalStatus();
  const apiUrl = assertString(localStatus.API_URL, 'API_URL');
  const publishableKey = assertString(
    localStatus.PUBLISHABLE_KEY,
    'PUBLISHABLE_KEY',
  );
  const secretKey = assertString(localStatus.SECRET_KEY, 'SECRET_KEY');
  const androidUrl = createAndroidUrl(apiUrl);
  const password = randomBytesImpl(32).toString('base64url');
  const adminHeaders = createHeaders(secretKey);
  const userIds = await listFixtureUserIds(fetchImpl, apiUrl, adminHeaders);

  for (const userId of userIds) {
    const deleteResponse = await fetchImpl(
      `${apiUrl}/auth/v1/admin/users/${userId}`,
      {method: 'DELETE', headers: adminHeaders},
    );
    await readResponse(deleteResponse, 'delete local fixture user', [200, 204]);
  }

  const createResponse = await fetchImpl(`${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email: fixtureEmail,
      password,
      email_confirm: true,
    }),
  });
  const createdUser = await readResponse(
    createResponse,
    'create confirmed local fixture user',
    [200, 201],
  );

  if (
    typeof createdUser?.id !== 'string' ||
    typeof createdUser?.email_confirmed_at !== 'string'
  ) {
    throw new Error('Created local fixture user is not confirmed.');
  }

  const passwordGrantResponse = await fetchImpl(
    `${apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: createHeaders(publishableKey),
      body: JSON.stringify({email: fixtureEmail, password}),
    },
  );
  const passwordGrant = await readResponse(
    passwordGrantResponse,
    'local fixture password grant',
    [200],
  );

  if (typeof passwordGrant?.access_token !== 'string') {
    throw new Error('Local fixture password grant is invalid.');
  }

  const onboardingResponse = await fetchImpl(
    `${apiUrl}/rest/v1/rpc/get_onboarding_status`,
    {
      method: 'POST',
      headers: createHeaders(publishableKey, passwordGrant.access_token),
      body: '{}',
    },
  );
  const onboardingStatus = await readResponse(
    onboardingResponse,
    'get_onboarding_status',
    [200],
  );
  assertPendingOnboarding(onboardingStatus);

  await writeFileImpl(
    temporaryEnvPath,
    createEnvironment({apiUrl, androidUrl, publishableKey, password}),
    {encoding: 'utf8', mode: 0o600},
  );
  await renameImpl(temporaryEnvPath, envPath);

  return {email: fixtureEmail, envPath};
}
