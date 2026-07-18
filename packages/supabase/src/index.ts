export {
  createSupabaseClient,
  type SupabaseClientConfig,
} from './client.ts';
export {
  AuthRepositoryError,
  createAuthRepository,
  type AuthRepository,
  type AuthRepositoryErrorKind,
  type PasswordSignInInput,
  type SocialIdTokenInput,
  type StoredSessionEvidence,
} from './auth-repository.ts';
export {
  parseOnboardingStatus,
  type AcceptedLegalDocument,
  type LegalDocumentKind,
  type OnboardingStatus,
  type RequiredLegalDocument,
} from './onboarding-status.ts';
export type {Database, Json} from './database.types.ts';
export type {Session, SupportedStorage} from '@supabase/supabase-js';
