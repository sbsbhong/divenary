import type {SupportedStorage} from '@repo/supabase';
import * as Keychain from 'react-native-keychain';

const service = 'com.divingapp.supabase.session';

const secureStorageFailure = () =>
  new Error('Secure session storage failed');

export const supabaseSessionStorage: SupportedStorage = {
  async setItem(key: string, value: string) {
    const result = await Keychain.setGenericPassword(key, value, {
      service,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });

    if (!result) {
      throw secureStorageFailure();
    }
  },

  async getItem(key: string) {
    const credentials = await Keychain.getGenericPassword({service});

    if (!credentials || credentials.username !== key) {
      return null;
    }

    return credentials.password;
  },

  async removeItem(key: string) {
    const credentials = await Keychain.getGenericPassword({service});

    if (!credentials || credentials.username !== key) {
      return;
    }

    const didRemove = await Keychain.resetGenericPassword({service});

    if (!didRemove) {
      throw secureStorageFailure();
    }
  },
};

export async function clearPersistedSupabaseSession(): Promise<void> {
  const credentials = await Keychain.getGenericPassword({service});

  if (!credentials) {
    return;
  }

  const didRemove = await Keychain.resetGenericPassword({service});

  if (!didRemove) {
    throw secureStorageFailure();
  }
}
