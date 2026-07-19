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
export {
  createAccountDataRepository,
  AccountDataRepositoryError,
  type AccountDataRepositoryOperation,
} from './account-data-repository.ts';
export {
  createGuestClaimRemoteRepository,
  GuestClaimRepositoryError,
  type GuestClaimRepositoryOperation,
} from './guest-claim-repository.ts';
export type {
  AccountDataCursor,
  AccountDataPage,
  AccountDataRepository,
  AccountMutationResult,
  GuestClaimBatchInput,
  GuestClaimRemoteRepository,
  GuestClaimStageInput,
  RemoteDiveLog,
  RemoteDivePlan,
  VerifiedCurrentUser,
} from './account-data-types.ts';
export type {Database, Json} from './database.types.ts';
export type {Session, SupportedStorage} from '@supabase/supabase-js';
