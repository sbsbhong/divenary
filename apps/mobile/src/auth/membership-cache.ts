import {
  createAsyncStorageKeyValueStore,
  type PersistentKeyValueStore,
} from '../storage/persistent-key-value-store';

export type MembershipCacheDocument = {
  kind: 'terms' | 'privacy';
  version: string;
};

export type MembershipCacheEntry = {
  userId: string;
  serverVerifiedAt: number;
  onboardingCompletedAt: string;
  documents: MembershipCacheDocument[];
};

export type MembershipCache = {
  load(): Promise<MembershipCacheEntry | undefined>;
  save(entry: MembershipCacheEntry): Promise<void>;
  remove(): Promise<void>;
};

export type MembershipCacheOptions = {
  storage?: PersistentKeyValueStore;
};

const storageKey = 'dive-app:auth:membership:v1';

export const createMembershipCache = (
  options: MembershipCacheOptions = {},
): MembershipCache => {
  const storage = options.storage ?? createAsyncStorageKeyValueStore();

  return {
    async load() {
      const rawValue = await storage.getString(storageKey);

      if (rawValue === undefined) {
        return undefined;
      }

      try {
        return parseMembershipCacheEntry(JSON.parse(rawValue));
      } catch {
        return undefined;
      }
    },

    async save(entry) {
      const canonicalEntry = canonicalMembershipCacheEntry(entry);

      if (canonicalEntry === undefined) {
        throw new TypeError('Invalid membership cache entry');
      }

      await storage.setString(
        storageKey,
        JSON.stringify({schemaVersion: 1, ...canonicalEntry}),
      );
    },

    async remove() {
      await storage.remove(storageKey);
    },
  };
};

function parseMembershipCacheEntry(
  value: unknown,
): MembershipCacheEntry | undefined {
  if (!isStrictObject(value, [
    'schemaVersion',
    'userId',
    'serverVerifiedAt',
    'onboardingCompletedAt',
    'documents',
  ])) {
    return undefined;
  }

  if (Reflect.get(value, 'schemaVersion') !== 1) {
    return undefined;
  }

  return canonicalMembershipCacheEntry({
    userId: Reflect.get(value, 'userId'),
    serverVerifiedAt: Reflect.get(value, 'serverVerifiedAt'),
    onboardingCompletedAt: Reflect.get(value, 'onboardingCompletedAt'),
    documents: Reflect.get(value, 'documents'),
  });
}

function canonicalMembershipCacheEntry(
  value: unknown,
): MembershipCacheEntry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const userId = Reflect.get(value, 'userId');
  const serverVerifiedAt = Reflect.get(value, 'serverVerifiedAt');
  const onboardingCompletedAt = Reflect.get(value, 'onboardingCompletedAt');
  const documents = Reflect.get(value, 'documents');

  if (
    typeof userId !== 'string' ||
    !userId ||
    typeof serverVerifiedAt !== 'number' ||
    !Number.isInteger(serverVerifiedAt) ||
    serverVerifiedAt <= 0 ||
    typeof onboardingCompletedAt !== 'string' ||
    !isRfc3339Timestamp(onboardingCompletedAt) ||
    !Array.isArray(documents) ||
    documents.length !== 2
  ) {
    return undefined;
  }

  const canonicalDocuments = documents
    .map(parseDocument)
    .filter(
      (document): document is MembershipCacheDocument =>
        document !== undefined,
    );
  const terms = canonicalDocuments.find(document => document.kind === 'terms');
  const privacy = canonicalDocuments.find(
    document => document.kind === 'privacy',
  );

  if (
    canonicalDocuments.length !== 2 ||
    terms === undefined ||
    privacy === undefined
  ) {
    return undefined;
  }

  return {
    userId,
    serverVerifiedAt,
    onboardingCompletedAt,
    documents: [terms, privacy],
  };
}

function parseDocument(value: unknown): MembershipCacheDocument | undefined {
  if (!isStrictObject(value, ['kind', 'version'])) {
    return undefined;
  }

  const kind = Reflect.get(value, 'kind');
  const version = Reflect.get(value, 'version');

  if (
    (kind !== 'terms' && kind !== 'privacy') ||
    typeof version !== 'string' ||
    !version
  ) {
    return undefined;
  }

  return {kind, version};
}

function isStrictObject(
  value: unknown,
  expectedKeys: string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every(key => Object.hasOwn(value, key))
  );
}

function isRfc3339Timestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
    value,
  );
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);

  return (
    match !== null &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    Number.isFinite(Date.parse(value))
  );
}

function daysInMonth(year: number, month: number): number {
  const isLeapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return days[month - 1] ?? 0;
}
