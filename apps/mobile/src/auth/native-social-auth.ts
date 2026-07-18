export type SocialProvider = 'google' | 'apple';

export type NativeSocialCredential =
  | {provider: 'google'; idToken: string}
  | {provider: 'apple'; idToken: string; nonce: string};

export type NativeSocialResult =
  | {type: 'credential'; credential: NativeSocialCredential}
  | {type: 'cancelled'};

export type NativeSocialSignIn = () => Promise<NativeSocialResult>;

export type NativeSocialAuthErrorCode =
  | 'unavailable'
  | 'missing_id_token'
  | 'missing_nonce'
  | 'provider';

export class NativeSocialAuthError extends Error {
  readonly code: NativeSocialAuthErrorCode;

  constructor(code: NativeSocialAuthErrorCode) {
    super('Social authentication failed');
    this.name = 'NativeSocialAuthError';
    this.code = code;
  }
}
