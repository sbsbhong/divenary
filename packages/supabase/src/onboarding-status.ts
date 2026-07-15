import type {Json} from './database.types.ts';

export type LegalDocumentKind = 'terms' | 'privacy';

export type RequiredLegalDocument = {
  kind: LegalDocumentKind;
  version: string;
  effectiveAt: string;
  documentUrl: string;
};

export type AcceptedLegalDocument = {
  kind: LegalDocumentKind;
  version: string;
};

export type OnboardingStatus = {
  isComplete: boolean;
  onboardingCompletedAt: string | null;
  requiredDocuments: RequiredLegalDocument[];
  acceptedDocuments: AcceptedLegalDocument[];
};

function invalidResponse(): never {
  throw new TypeError('Invalid onboarding status response');
}

function isJsonObject(
  value: Json | undefined,
): value is {[key: string]: Json | undefined} {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}

function parseKind(value: Json | undefined): LegalDocumentKind {
  if (value !== 'terms' && value !== 'privacy') {
    return invalidResponse();
  }

  return value;
}

function parseNonEmptyString(value: Json | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    return invalidResponse();
  }

  return value;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
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

function parseTimestamp(value: Json | undefined): string {
  if (typeof value !== 'string') {
    return invalidResponse();
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
    value,
  );
  const yearText = match?.[1];
  const monthText = match?.[2];
  const dayText = match?.[3];

  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return invalidResponse();
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || !Number.isFinite(Date.parse(value))
  ) {
    return invalidResponse();
  }

  return value;
}

function parseHttpsUrl(value: Json | undefined): string {
  if (typeof value !== 'string') {
    return invalidResponse();
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return invalidResponse();
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.length === 0
    || parsed.username.length > 0
    || parsed.password.length > 0
  ) {
    return invalidResponse();
  }

  return value;
}

function parseRequiredDocument(value: Json): RequiredLegalDocument {
  if (!isJsonObject(value)) {
    return invalidResponse();
  }

  return {
    kind: parseKind(value.kind),
    version: parseNonEmptyString(value.version),
    effectiveAt: parseTimestamp(value.effectiveAt),
    documentUrl: parseHttpsUrl(value.documentUrl),
  };
}

function parseAcceptedDocument(value: Json): AcceptedLegalDocument {
  if (!isJsonObject(value)) {
    return invalidResponse();
  }

  return {
    kind: parseKind(value.kind),
    version: parseNonEmptyString(value.version),
  };
}

function canonicalRequiredDocuments(value: Json | undefined) {
  if (!Array.isArray(value) || value.length !== 2) {
    return invalidResponse();
  }

  const documents = value.map(parseRequiredDocument);
  const terms = documents.find(document => document.kind === 'terms');
  const privacy = documents.find(document => document.kind === 'privacy');

  if (terms === undefined || privacy === undefined) {
    return invalidResponse();
  }

  return [terms, privacy];
}

function canonicalAcceptedDocuments(
  value: Json | undefined,
  requiredDocuments: RequiredLegalDocument[],
) {
  if (!Array.isArray(value) || value.length > 2) {
    return invalidResponse();
  }

  const accepted = value.map(parseAcceptedDocument);
  const terms = accepted.find(document => document.kind === 'terms');
  const privacy = accepted.find(document => document.kind === 'privacy');

  if (
    accepted.filter(document => document.kind === 'terms').length > 1
    || accepted.filter(document => document.kind === 'privacy').length > 1
  ) {
    return invalidResponse();
  }

  for (const document of accepted) {
    const required = requiredDocuments.find(
      candidate => candidate.kind === document.kind,
    );

    if (required === undefined || required.version !== document.version) {
      return invalidResponse();
    }
  }

  return [terms, privacy].filter(
    (document): document is AcceptedLegalDocument => document !== undefined,
  );
}

export function parseOnboardingStatus(value: Json): OnboardingStatus {
  if (!isJsonObject(value) || typeof value.isComplete !== 'boolean') {
    return invalidResponse();
  }

  const onboardingCompletedAt = value.onboardingCompletedAt === null
    ? null
    : parseTimestamp(value.onboardingCompletedAt);
  const required = canonicalRequiredDocuments(value.requiredDocuments);
  const accepted = canonicalAcceptedDocuments(value.acceptedDocuments, required);
  const computedComplete = onboardingCompletedAt !== null && accepted.length === 2;

  if (value.isComplete !== computedComplete) {
    return invalidResponse();
  }

  return {
    isComplete: value.isComplete,
    onboardingCompletedAt,
    requiredDocuments: required,
    acceptedDocuments: accepted,
  };
}
