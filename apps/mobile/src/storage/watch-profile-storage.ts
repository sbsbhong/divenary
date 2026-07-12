import { NativeModules, Platform } from 'react-native';
import type { WatchDepthSample } from '../types/dive-session';
import type { PersistentKeyValueStore } from './persistent-key-value-store';

export type WatchProfileStorage = {
  write(key: string, samples: WatchDepthSample[]): Promise<void>;
  read(key: string): Promise<WatchDepthSample[] | undefined>;
  remove(key: string): Promise<void>;
};

type NativeWatchProfileStorageModule = {
  writeProfile(key: string, payloadJson: string): Promise<string>;
  readProfile(key: string): Promise<string>;
  deleteProfile(key: string): Promise<void>;
};

const nativeModule = Platform.OS === 'ios'
  ? (NativeModules.WatchProfileStorageModule as NativeWatchProfileStorageModule | undefined)
  : undefined;

export function createWatchProfileStorage(fallback: PersistentKeyValueStore): WatchProfileStorage {
  if (nativeModule?.writeProfile && nativeModule.readProfile && nativeModule.deleteProfile) {
    return {
      async write(key, samples) {
        await nativeModule.writeProfile(key, JSON.stringify(samples));
      },
      async read(key) {
        try {
          return JSON.parse(await nativeModule.readProfile(key)) as WatchDepthSample[];
        } catch {
          return undefined;
        }
      },
      async remove(key) {
        await nativeModule.deleteProfile(key);
      },
    };
  }

  return {
    async write(key, samples) {
      await fallback.setString(key, JSON.stringify(samples));
    },
    async read(key) {
      const stored = await fallback.getString(key);
      return stored ? JSON.parse(stored) as WatchDepthSample[] : undefined;
    },
    async remove(key) {
      await fallback.remove(key);
    },
  };
}
