import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';

import type {GoogleEnvironment} from '../config/env';
import {
  NativeSocialAuthError,
  type NativeSocialResult,
  type NativeSocialSignIn,
} from './native-social-auth';

export const createGoogleNativeAuth = (
  environment: GoogleEnvironment,
): NativeSocialSignIn => {
  GoogleSignin.configure({
    webClientId: environment.webClientId,
    iosClientId: environment.iosClientId,
    offlineAccess: false,
  });

  return signInWithGoogle;
};

export async function signInWithGoogle(): Promise<NativeSocialResult> {
  let response: Awaited<ReturnType<typeof GoogleSignin.signIn>>;

  try {
    response = await GoogleSignin.signIn();
  } catch {
    throw new NativeSocialAuthError('provider');
  }

  if (isCancelledResponse(response)) {
    return {type: 'cancelled'};
  }

  if (!isSuccessResponse(response)) {
    throw new NativeSocialAuthError('provider');
  }

  const idToken = response.data.idToken;

  if (typeof idToken !== 'string' || !idToken.trim()) {
    throw new NativeSocialAuthError('missing_id_token');
  }

  return {
    type: 'credential',
    credential: {provider: 'google', idToken},
  };
}
