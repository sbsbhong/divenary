import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
} from '@supabase/supabase-js';

import type {Database} from './database.types.ts';

export type SupabaseClientConfig = {
  url: string;
  publishableKey: string;
  storage: SupportedStorage;
};

export function createSupabaseClient(
  config: SupabaseClientConfig,
): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      storage: config.storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      throwOnError: false,
    },
  });
}
