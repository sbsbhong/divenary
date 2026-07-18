jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    signIn: jest.fn(),
  },
  isCancelledResponse: jest.fn(response => response.type === 'cancelled'),
  isSuccessResponse: jest.fn(response => response.type === 'success'),
}));

jest.mock('@invertase/react-native-apple-authentication', () => ({
  appleAuth: {
    isSupported: true,
    performRequest: jest.fn(),
    Error: {CANCELED: '1001'},
    Operation: {LOGIN: 1},
    Scope: {EMAIL: 0, FULL_NAME: 1},
  },
}));

import {appleAuth} from '@invertase/react-native-apple-authentication';
import {
  GoogleSignin,
  type SignInResponse,
} from '@react-native-google-signin/google-signin';
import {Platform} from 'react-native';

import {
  isAppleNativeAuthAvailable,
  signInWithApple,
} from '../src/auth/apple-native-auth';
import {
  createGoogleNativeAuth,
  signInWithGoogle,
} from '../src/auth/google-native-auth';
import {NativeSocialAuthError} from '../src/auth/native-social-auth';

const mockGoogleConfigure = jest.mocked(GoogleSignin.configure);
const mockGoogleSignIn = jest.mocked(GoogleSignin.signIn);
const mockApplePerformRequest = jest.mocked(appleAuth.performRequest);

const googleEnvironment = {
  webClientId: 'google-web-client-id',
  iosClientId: 'google-ios-client-id',
};

const googleResponse = (value: unknown) => value as SignInResponse;
const appleResponse = (value: unknown) =>
  value as Awaited<ReturnType<typeof appleAuth.performRequest>>;

describe('native social authentication adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    Object.defineProperty(appleAuth, 'isSupported', {
      configurable: true,
      value: true,
    });
  });

  test('configures one Google adapter with public client IDs and no offline access', () => {
    const adapter = createGoogleNativeAuth(googleEnvironment);

    expect(adapter).toBe(signInWithGoogle);
    expect(mockGoogleConfigure).toHaveBeenCalledTimes(1);
    expect(mockGoogleConfigure).toHaveBeenCalledWith({
      webClientId: 'google-web-client-id',
      iosClientId: 'google-ios-client-id',
      offlineAccess: false,
    });
  });

  test('returns neutral Google cancellation and only a successful ID token', async () => {
    mockGoogleSignIn.mockResolvedValueOnce(
      googleResponse({type: 'cancelled', data: null}),
    );
    await expect(signInWithGoogle()).resolves.toEqual({type: 'cancelled'});

    mockGoogleSignIn.mockResolvedValueOnce(
      googleResponse({
        type: 'success',
        data: {
          idToken: 'google-id-token',
          user: {email: 'must-not-leave-adapter@example.com'},
          serverAuthCode: 'must-not-leave-adapter',
        },
      }),
    );
    await expect(signInWithGoogle()).resolves.toEqual({
      type: 'credential',
      credential: {provider: 'google', idToken: 'google-id-token'},
    });
  });

  test('maps missing Google tokens and provider failures to generic typed errors', async () => {
    mockGoogleSignIn.mockResolvedValueOnce(
      googleResponse({type: 'success', data: {idToken: null}}),
    );
    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'NativeSocialAuthError',
      code: 'missing_id_token',
      message: 'Social authentication failed',
    });

    const googlePayload =
      'google-id-token google-user@example.invalid provider payload';
    mockGoogleSignIn.mockRejectedValueOnce(new Error(googlePayload));
    const error = await signInWithGoogle().catch(value => value);
    expect(error).toBeInstanceOf(NativeSocialAuthError);
    expect(error).toMatchObject({
      code: 'provider',
      message: 'Social authentication failed',
    });
    expect(Reflect.has(error, 'cause')).toBe(false);
    expect(JSON.stringify(error)).not.toContain(googlePayload);
  });

  test('lets the Apple SDK own nonce generation and returns its raw nonce', async () => {
    mockApplePerformRequest.mockResolvedValueOnce(
      appleResponse({
        identityToken: 'apple-id-token',
        nonce: 'raw-sdk-nonce',
        email: 'must-not-leave-adapter@example.com',
      }),
    );

    await expect(signInWithApple()).resolves.toEqual({
      type: 'credential',
      credential: {
        provider: 'apple',
        idToken: 'apple-id-token',
        nonce: 'raw-sdk-nonce',
      },
    });
    expect(mockApplePerformRequest).toHaveBeenCalledWith({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.EMAIL],
    });
    expect(mockApplePerformRequest.mock.calls[0]?.[0]).not.toHaveProperty(
      'nonce',
    );
    expect(mockApplePerformRequest.mock.calls[0]?.[0]).not.toHaveProperty(
      'nonceEnabled',
    );
  });

  test('maps only the Apple SDK cancellation code to a neutral result', async () => {
    mockApplePerformRequest.mockRejectedValueOnce({
      code: appleAuth.Error.CANCELED,
    });
    await expect(signInWithApple()).resolves.toEqual({type: 'cancelled'});

    const applePayload = {
      code: '1004',
      idToken: 'apple-id-token',
      nonce: 'apple-raw-nonce',
      email: 'apple-user@example.invalid',
    };
    mockApplePerformRequest.mockRejectedValueOnce(applePayload);
    const error = await signInWithApple().catch(value => value);
    expect(error).toMatchObject({
      name: 'NativeSocialAuthError',
      code: 'provider',
      message: 'Social authentication failed',
    });
    expect(Reflect.has(error, 'cause')).toBe(false);
    expect(JSON.stringify(error)).not.toContain(applePayload.idToken);
    expect(JSON.stringify(error)).not.toContain(applePayload.nonce);
    expect(JSON.stringify(error)).not.toContain(applePayload.email);
  });

  test.each([
    [{identityToken: null, nonce: 'raw-sdk-nonce'}, 'missing_id_token'],
    [{identityToken: 'apple-id-token', nonce: ''}, 'missing_nonce'],
  ])('rejects incomplete Apple credential response %#', async (response, code) => {
    mockApplePerformRequest.mockResolvedValueOnce(appleResponse(response));
    await expect(signInWithApple()).rejects.toMatchObject({code});
  });

  test('rejects Apple before requesting credentials when unavailable', async () => {
    Object.defineProperty(appleAuth, 'isSupported', {value: false});
    expect(isAppleNativeAuthAvailable()).toBe(false);
    await expect(signInWithApple()).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(mockApplePerformRequest).not.toHaveBeenCalled();

    Object.defineProperty(appleAuth, 'isSupported', {value: true});
    Object.defineProperty(Platform, 'OS', {value: 'android'});
    expect(isAppleNativeAuthAvailable()).toBe(false);
    await expect(signInWithApple()).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(mockApplePerformRequest).not.toHaveBeenCalled();
  });
});
