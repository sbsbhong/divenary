jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
      'AccessibleAfterFirstUnlockThisDeviceOnly',
  },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

import * as Keychain from 'react-native-keychain';
import {
  clearPersistedSupabaseSession,
  supabaseSessionStorage,
} from '../src/auth/keychain-session-storage';

const mockSetGenericPassword = jest.mocked(Keychain.setGenericPassword);
const mockGetGenericPassword = jest.mocked(Keychain.getGenericPassword);
const mockResetGenericPassword = jest.mocked(Keychain.resetGenericPassword);

const service = 'com.divingapp.supabase.session';

describe('Supabase Keychain session storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetGenericPassword.mockResolvedValue({
      service,
      storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
    });
    mockGetGenericPassword.mockResolvedValue(false);
    mockResetGenericPassword.mockResolvedValue(true);
  });

  test('stores the Supabase storage key as username with device-only accessibility', async () => {
    await supabaseSessionStorage.setItem('supabase.auth.token', 'serialized-session');

    expect(mockSetGenericPassword).toHaveBeenCalledWith(
      'supabase.auth.token',
      'serialized-session',
      {
        service,
        accessible: 'AccessibleAfterFirstUnlockThisDeviceOnly',
      },
    );
  });

  test('returns only a credential whose username matches the requested key', async () => {
    mockGetGenericPassword.mockResolvedValueOnce({
      service,
      storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
      username: 'supabase.auth.token',
      password: 'serialized-session',
    });

    await expect(
      supabaseSessionStorage.getItem('supabase.auth.token'),
    ).resolves.toBe('serialized-session');
    expect(mockGetGenericPassword).toHaveBeenCalledWith({service});

    mockGetGenericPassword.mockResolvedValueOnce({
      service,
      storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
      username: 'another-project.auth.token',
      password: 'other-session',
    });
    await expect(
      supabaseSessionStorage.getItem('supabase.auth.token'),
    ).resolves.toBeNull();

    mockGetGenericPassword.mockResolvedValueOnce(false);
    await expect(
      supabaseSessionStorage.getItem('supabase.auth.token'),
    ).resolves.toBeNull();
  });

  test('removes only a matching Keychain credential', async () => {
    mockGetGenericPassword.mockResolvedValueOnce({
      service,
      storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
      username: 'another-project.auth.token',
      password: 'other-session',
    });
    await supabaseSessionStorage.removeItem('supabase.auth.token');
    expect(mockResetGenericPassword).not.toHaveBeenCalled();

    mockGetGenericPassword.mockResolvedValueOnce({
      service,
      storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
      username: 'supabase.auth.token',
      password: 'serialized-session',
    });
    await supabaseSessionStorage.removeItem('supabase.auth.token');
    expect(mockResetGenericPassword).toHaveBeenCalledWith({service});
  });

  test('rejects native failure without logging keys or values', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSetGenericPassword.mockRejectedValueOnce(new Error('native failure'));

    try {
      await expect(
        supabaseSessionStorage.setItem('secret-key', 'secret-value'),
      ).rejects.toThrow('native failure');
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  test('treats false native set/reset results as generic storage failure', async () => {
    mockSetGenericPassword.mockResolvedValueOnce(false);
    await expect(
      supabaseSessionStorage.setItem('supabase.auth.token', 'session'),
    ).rejects.toThrow('Secure session storage failed');

    mockGetGenericPassword.mockResolvedValueOnce({
      service,
      storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
      username: 'supabase.auth.token',
      password: 'session',
    });
    mockResetGenericPassword.mockResolvedValueOnce(false);
    await expect(
      supabaseSessionStorage.removeItem('supabase.auth.token'),
    ).rejects.toThrow('Secure session storage failed');
  });

  test('clears any persisted session without needing the Supabase storage key', async () => {
    mockGetGenericPassword.mockResolvedValueOnce({
      service,
      storage: 'KeystoreAESGCM_NoAuth' as Keychain.STORAGE_TYPE,
      username: 'sb-project-auth-token',
      password: 'session',
    });

    await clearPersistedSupabaseSession();

    expect(mockResetGenericPassword).toHaveBeenCalledWith({service});
  });

  test('treats an already empty session store as cleared', async () => {
    await clearPersistedSupabaseSession();

    expect(mockResetGenericPassword).not.toHaveBeenCalled();
  });
});
