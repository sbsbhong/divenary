import {createClient} from 'npm:@supabase/supabase-js@2.110.2';

type AbandonRequest = {batchId: string};
type AbandonResult = {
  batchId: string;
  status: 'abandoned' | 'committed';
  profilePaths: string[];
};

const knownStatus = {
  invalid_token: 401,
  batch_not_found: 404,
  claim_validation_failed: 409,
} as const;

type KnownCode = keyof typeof knownStatus;

class KnownFailure extends Error {
  constructor(readonly code: KnownCode) {
    super(code);
  }
}

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new KnownFailure('claim_validation_failed');
  }
  return value;
}

function readBearer(request: Request): string {
  const match = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    throw new KnownFailure('invalid_token');
  }
  return match[1];
}

async function readRequest(request: Request): Promise<AbandonRequest> {
  if (request.method !== 'POST') {
    throw new KnownFailure('claim_validation_failed');
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new KnownFailure('claim_validation_failed');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !('batchId' in parsed) ||
    typeof parsed.batchId !== 'string' ||
    !uuidPattern.test(parsed.batchId)
  ) {
    throw new KnownFailure('claim_validation_failed');
  }
  return {batchId: parsed.batchId};
}

function parseResult(
  data: unknown,
  userId: string,
  batchId: string,
): AbandonResult {
  if (
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data) ||
    !('batchId' in data) ||
    data.batchId !== batchId ||
    !('status' in data) ||
    (data.status !== 'abandoned' && data.status !== 'committed') ||
    !('profilePaths' in data) ||
    !Array.isArray(data.profilePaths)
  ) {
    throw new KnownFailure('claim_validation_failed');
  }
  const profilePaths = data.profilePaths;
  if (
    profilePaths.some(
      path =>
        typeof path !== 'string' ||
        !isOwnedClaimProfilePath(path, userId, batchId),
    ) ||
    new Set(profilePaths).size !== profilePaths.length ||
    (data.status === 'committed' && profilePaths.length !== 0)
  ) {
    throw new KnownFailure('claim_validation_failed');
  }
  return {
    batchId,
    status: data.status,
    profilePaths: profilePaths as string[],
  };
}

function isOwnedClaimProfilePath(
  path: string,
  userId: string,
  batchId: string,
): boolean {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decodedPath.includes('\\')) {
    return false;
  }
  const segments = decodedPath.split('/');
  return (
    segments.length === 5 &&
    segments[0] === userId &&
    segments[1] === 'claims' &&
    segments[2] === batchId &&
    uuidPattern.test(segments[3]) &&
    segments[4].length > '.json'.length &&
    segments[4].endsWith('.json') &&
    segments.every(
      segment => segment.length > 0 && segment !== '.' && segment !== '..',
    )
  );
}

Deno.serve(async request => {
  try {
    const jwt = readBearer(request);
    const supabaseUrl = requiredEnvironment('SUPABASE_URL');
    const publishableKey = requiredEnvironment('SUPABASE_ANON_KEY');
    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const {
      data: {user},
      error: authenticationError,
    } = await authClient.auth.getUser(jwt);
    if (authenticationError || !user) {
      throw new KnownFailure('invalid_token');
    }

    const {batchId} = await readRequest(request);
    const serviceClient = createClient(
      supabaseUrl,
      requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
    const {data, error} = await serviceClient.rpc('abandon_guest_claim', {
      p_user_id: user.id,
      p_batch_id: batchId,
    });
    if (error) {
      throw new KnownFailure(
        error.code === 'P0001'
          ? 'batch_not_found'
          : 'claim_validation_failed',
      );
    }
    const result = parseResult(data, user.id, batchId);
    let storageCleanupPending = false;
    if (result.status === 'abandoned' && result.profilePaths.length > 0) {
      const cleanup = await serviceClient.storage
        .from('dive-profiles')
        .remove(result.profilePaths);
      storageCleanupPending = cleanup.error !== null;
    }
    return jsonResponse({
      batchId,
      status: result.status,
      storageCleanupPending,
    });
  } catch (error) {
    const code =
      error instanceof KnownFailure
        ? error.code
        : 'claim_validation_failed';
    return jsonResponse({code}, knownStatus[code]);
  }
});
