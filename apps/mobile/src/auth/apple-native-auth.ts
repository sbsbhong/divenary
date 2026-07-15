import {appleAuth} from '@invertase/react-native-apple-authentication';
import {Platform} from 'react-native';

import {
  NativeSocialAuthError,
  type NativeSocialResult,
} from './native-social-auth';

export const isAppleNativeAuthAvailable = () =>
  Platform.OS === 'ios' && appleAuth.isSupported;

export async function signInWithApple(): Promise<NativeSocialResult> {
  if (!isAppleNativeAuthAvailable()) {
    throw new NativeSocialAuthError('unavailable');
  }

  let response: Awaited<ReturnType<typeof appleAuth.performRequest>>;

  try {
    response = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.EMAIL],
    });
  } catch (error) {
    if (readErrorCode(error) === appleAuth.Error.CANCELED) {
      return {type: 'cancelled'};
    }

    throw new NativeSocialAuthError('provider', {cause: error});
  }

  const idToken = response.identityToken;

  if (typeof idToken !== 'string' || !idToken.trim()) {
    throw new NativeSocialAuthError('missing_id_token');
  }

  const nonce = response.nonce;

  if (typeof nonce !== 'string' || !nonce.trim()) {
    throw new NativeSocialAuthError('missing_nonce');
  }

  return {
    type: 'credential',
    credential: {provider: 'apple', idToken, nonce},
  };
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}
